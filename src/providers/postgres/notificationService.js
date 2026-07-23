/** SMTP + alert digest notifications. */
const nodemailer = require('nodemailer');
const { query } = require('./pool');
const { HttpError } = require('../../utils/httpError');
const dashboardService = require('./dashboardService');
const { renderEmail } = require('../../utils/emailLayout');
const { encryptSecret, decryptSecret } = require('../../utils/secretCrypto');
const { resolveAndAssertPublicHost, smtpAllowsPrivate } = require('../../utils/safeOutbound');
const {
  TEMPLATE_KEYS,
  PLACEHOLDERS,
  mergeTemplates,
  sanitizeTemplateInput,
  renderTemplate,
  DEFAULT_ACCESS,
} = require('../../utils/emailTemplates');

/** Where links in templated mail point. */
function appBaseUrl() {
  return process.env.APP_URL || process.env.PUBLIC_URL || 'http://localhost:8000';
}

/** Minimal document shell around a rendered template body. */
function wrapHtmlBody(bodyHtml) {
  return '<!DOCTYPE html><html><head><meta charset="utf-8"></head>'
    + '<body style="font-family:system-ui,-apple-system,sans-serif;line-height:1.5;color:#1a1a1a;'
    + 'max-width:640px;margin:0 auto;padding:24px">'
    + `${bodyHtml}</body></html>`;
}

const DEFAULT_NOTIFY = {
  enabled: false,
  to: [],
  lowStock: true,
  licenseExpiry: true,
  licenseExpired: true,
  eol: true,
  onboarding: true,
  handoverCompleted: false,
};

function materializeSmtp(smtp) {
  if (!smtp || typeof smtp !== 'object') return {};
  const raw = smtp.pass || '';
  const pass = decryptSecret(raw);
  // Encrypted blob that decrypts to empty → JWT_SECRET rotated / corrupt ciphertext.
  // Without this flag, sendMail only sees an empty password and the UI may look fine.
  const passCorrupt = typeof raw === 'string' && raw.startsWith('enc:v1:') && !pass;
  const passConfigured = !!(raw && String(raw).length > 0);
  return {
    ...smtp,
    pass,
    passCorrupt,
    passConfigured,
  };
}

/**
 * Provider-specific SMTP defaults. iCloud (smtp.mail.me.com) often times out on
 * port 465 from Docker/cloud NATs; Apple documents STARTTLS on 587 instead.
 */
function normalizeSmtpTransport(smtp) {
  const host = String(smtp.host || '').trim().toLowerCase();
  const port = Number(smtp.port) || 587;
  let secure = smtp.secure != null ? !!smtp.secure : port === 465;
  let nextPort = port;
  if (host === 'smtp.mail.me.com' || host === 'mail.me.com') {
    if (port === 465 || secure) {
      nextPort = 587;
      secure = false;
    }
  }
  return { ...smtp, host, port: nextPort, secure };
}

async function getMailConfig() {
  const { rows } = await query(
    'SELECT smtp_json, notify_json, company_name FROM app_settings WHERE id = 1'
  );
  const smtp = materializeSmtp(rows[0]?.smtp_json || {});
  const notify = { ...DEFAULT_NOTIFY, ...(rows[0]?.notify_json || {}) };
  return { smtp, notify, companyName: rows[0]?.company_name || 'ITACM' };
}

const MASKED_PASS = '••••••••';

function isBlankOrMaskedPass(pass) {
  if (pass == null) return true;
  const s = String(pass);
  return !s || s === MASKED_PASS;
}

async function assertSmtpHostSafe(host) {
  if (!host) return;
  await resolveAndAssertPublicHost(host, {
    field: 'SMTP host',
    allowPrivate: smtpAllowsPrivate(),
  });
}

async function saveMailConfig({ smtp, notify }) {
  const sets = [];
  const params = [];
  if (smtp !== undefined) {
    if (typeof smtp !== 'object' || Array.isArray(smtp)) throw HttpError.badRequest('smtp must be an object');
    const cur = await getMailConfig();
    const typedPass = smtp.pass;
    // Empty / masked password = keep existing secret (never persist the UI placeholder).
    let nextPassPlain = isBlankOrMaskedPass(typedPass)
      ? (cur.smtp?.pass || '')
      : String(typedPass).slice(0, 200);
    // Corrupt ciphertext + blank form would otherwise re-save an empty password.
    if (isBlankOrMaskedPass(typedPass) && (cur.smtp?.passCorrupt || !nextPassPlain)) {
      if (smtp.user || smtp.host) {
        throw HttpError.badRequest(
          'SMTP password is missing or could not be read — enter the mail password (app-specific for iCloud/Gmail) and Save'
        );
      }
    }
    const normalized = normalizeSmtpTransport({
      host: String(smtp.host || '').slice(0, 200),
      port: Math.min(65535, Math.max(1, Number(smtp.port) || 587)),
      secure: !!smtp.secure,
      user: String(smtp.user || '').slice(0, 200),
      from: String(smtp.from || '').slice(0, 200),
    });
    await assertSmtpHostSafe(normalized.host);
    params.push(JSON.stringify({
      host: normalized.host,
      port: normalized.port,
      secure: normalized.secure,
      user: normalized.user,
      pass: encryptSecret(nextPassPlain),
      from: normalized.from,
    }));
    sets.push(`smtp_json = $${params.length}::jsonb`);
  }
  if (notify !== undefined) {
    if (typeof notify !== 'object' || Array.isArray(notify)) throw HttpError.badRequest('notify must be an object');
    const to = Array.isArray(notify.to)
      ? notify.to.map((e) => String(e).trim().toLowerCase()).filter(Boolean).slice(0, 20)
      : [];
    params.push(JSON.stringify({
      enabled: !!notify.enabled,
      to,
      lowStock: notify.lowStock !== false,
      licenseExpiry: notify.licenseExpiry !== false,
      licenseExpired: notify.licenseExpired !== false,
      eol: notify.eol !== false,
      onboarding: notify.onboarding !== false,
      handoverCompleted: !!notify.handoverCompleted,
    }));
    sets.push(`notify_json = $${params.length}::jsonb`);
  }
  if (!sets.length) return getMailConfig();
  await query(`UPDATE app_settings SET ${sets.join(', ')} WHERE id = 1`, params);
  return getMailConfig();
}

/** Wipe SMTP credentials and/or recipient/digest toggles back to defaults. */
async function clearMailConfig({ smtp = true, notify = true } = {}) {
  const parts = [];
  if (smtp) parts.push(`smtp_json = '{}'::jsonb`);
  if (notify) parts.push(`notify_json = '{}'::jsonb`);
  if (!parts.length) return getMailConfig();
  await query(`UPDATE app_settings SET ${parts.join(', ')} WHERE id = 1`);
  return getMailConfig();
}

function buildTransport(smtp) {
  const n = normalizeSmtpTransport(smtp);
  if (!n.host) throw HttpError.badRequest('SMTP host is required');
  const port = Number(n.port) || 587;
  const secure = n.secure != null ? !!n.secure : port === 465;
  const auth = n.user ? { user: n.user, pass: n.pass || '' } : undefined;
  return nodemailer.createTransport({
    host: n.host,
    port,
    secure,
    // STARTTLS on 587 when not using implicit TLS
    requireTLS: !secure && port === 587,
    auth,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
    // Prevent nodemailer from following unexpected redirects / local sockets.
    tls: { minVersion: 'TLSv1.2' },
  });
}

function mapSmtpError(err, smtp = {}) {
  const msg = String(err?.message || err || '');
  const code = err?.code || err?.responseCode;
  const response = String(err?.response || '');
  const port = Number(smtp.port) || 0;
  if (/Invalid login|authentication failed|535/i.test(msg + response)
    || code === 535) {
    return HttpError.badRequest(
      'SMTP authentication failed. For iCloud/Gmail use an app-specific password '
      + '(not your normal account password), then Save SMTP and try again.'
    );
  }
  if (/ECONNREFUSED|ETIMEDOUT|ESOCKET|ENOTFOUND|ECONNRESET|connection timed out|Connection timeout/i.test(msg)
    || code === 'ECONNECTION' || code === 'ETIMEDOUT' || code === 'EDNS') {
    if (port === 465 || smtp.secure) {
      return HttpError.badRequest(
        'Cannot reach SMTP on port 465/TLS. For iCloud use host smtp.mail.me.com, port 587, and leave “TLS (port 465)” unchecked, then Save and retry.'
      );
    }
    return HttpError.badRequest(
      `Cannot reach SMTP server (${msg.slice(0, 120)}). Check host, port, and TLS (465 = TLS on; iCloud prefers 587 without that checkbox).`
    );
  }
  if (/self[- ]signed|certificate/i.test(msg)) {
    return HttpError.badRequest('SMTP TLS certificate error — check host/port or use a trusted mail server.');
  }
  return HttpError.badRequest(`SMTP error: ${msg.slice(0, 180)}`);
}

async function sendMail({ to, subject, text, html }) {
  const { smtp, companyName } = await getMailConfig();
  if (!smtp.host) throw HttpError.badRequest('SMTP host is required — save SMTP settings first');
  await assertSmtpHostSafe(smtp.host);
  if (smtp.passCorrupt) {
    throw HttpError.badRequest(
      'SMTP password could not be decrypted (server secret may have changed) — re-enter the mail password in Integrations → Email and Save'
    );
  }
  if (smtp.user && !smtp.pass) {
    throw HttpError.badRequest('SMTP password is empty — enter your mail password (app-specific for iCloud/Gmail) and Save');
  }
  const transport = buildTransport(smtp);
  const from = smtp.from || smtp.user || `noreply@${companyName.replace(/\s+/g, '').toLowerCase()}.local`;
  const recipients = Array.isArray(to) ? to : [to];
  try {
    await transport.sendMail({
      from,
      to: recipients.join(', '),
      subject: String(subject || '').slice(0, 200),
      text: text || '',
      html: html || undefined,
    });
  } catch (err) {
    throw mapSmtpError(err, smtp);
  }
  return { sent: true, to: recipients };
}

async function sendTestEmail(to) {
  const { notify, smtp, companyName } = await getMailConfig();
  const dest = to || (notify.to && notify.to[0]);
  if (!dest) throw HttpError.badRequest('Provide a recipient email in Recipients, then try again');
  if (!smtp.host) throw HttpError.badRequest('Save SMTP host first');
  const mail = renderEmail({
    companyName,
    eyebrow: 'SMTP configuration',
    title: 'Test message delivered',
    intro: 'Your outgoing mail settings are working. Digests and handover alerts will use this same design.',
    meta: [
      { label: 'SMTP host', value: smtp.host || '—' },
      { label: 'From', value: smtp.from || smtp.user || '—' },
      { label: 'Sent to', value: dest },
    ],
    footerNote: `${companyName} · ITACM notification test`,
  });
  return sendMail({
    to: dest,
    subject: `[ITACM] SMTP test — ${companyName}`,
    text: mail.text,
    html: mail.html,
  });
}

function itemRows(items, mapFn) {
  return (items || []).slice(0, 25).map(mapFn).filter(Boolean);
}

async function runAlertDigest() {
  const { smtp, notify, companyName } = await getMailConfig();
  if (!notify.enabled) return { skipped: true, reason: 'notifications disabled' };
  if (!notify.to.length) return { skipped: true, reason: 'no recipients' };
  if (!smtp.host) return { skipped: true, reason: 'smtp not configured' };

  const dash = await dashboardService.getDashboardStats();
  const a = dash.alerts || {};
  const sections = [];
  let count = 0;

  if (notify.licenseExpired && a.expiredLicenseCount) {
    count += a.expiredLicenseCount;
    sections.push({
      heading: `Expired licenses (${a.expiredLicenseCount})`,
      rows: itemRows(a.expiredLicenses, (x) =>
        `${x.softwareName || x.name || x.id} · ${x.expirationDate || ''}`),
    });
  }
  if (notify.licenseExpiry && a.expiringLicenseCount) {
    count += a.expiringLicenseCount;
    sections.push({
      heading: `Expiring within 30 days (${a.expiringLicenseCount})`,
      rows: itemRows(a.expiringLicenses, (x) =>
        `${x.softwareName || x.name || x.id} · ${x.expirationDate || ''}`),
    });
  }
  if (notify.lowStock && a.lowStockCount) {
    count += a.lowStockCount;
    sections.push({
      heading: `Low stock (${a.lowStockCount})`,
      rows: itemRows(a.lowStockConsumables, (x) =>
        `${x.name || x.id}: ${x.totalStock}/${x.minimumStockAlertLevel}`),
    });
  }
  if (notify.eol && a.eolOverdueCount) {
    count += a.eolOverdueCount;
    sections.push({
      heading: `EOL overdue (${a.eolOverdueCount})`,
      rows: itemRows(a.eolOverdue, (x) =>
        `${x.assetTag || x.id} · ${[x.brand, x.model].filter(Boolean).join(' ')}`),
    });
  }
  if (notify.onboarding && a.onboardingDueCount) {
    count += a.onboardingDueCount;
    sections.push({
      heading: `Onboarding due (${a.onboardingDueCount})`,
      rows: itemRows(a.onboardingDue, (x) =>
        `${x.employeeName || x.id} · ${x.startDate || ''}`),
    });
  }

  if (!count) return { skipped: true, reason: 'no alerts', recipients: notify.to };

  // Flatten the sections into one editable placeholder — the digest body is a
  // template now (Integrations → Email templates), so what you edit is what ships.
  const alertSummary = sections
    .map((s) => [s.heading, ...s.rows.map((r) => `  - ${r}`)].join('\n'))
    .join('\n\n') || '(no details)';
  const templates = await getEmailTemplates();
  const rendered = renderTemplate(templates.alert_digest, {
    companyName,
    alertCount: String(count),
    alertSummary,
    appUrl: appBaseUrl(),
  });

  await sendMail({
    to: notify.to,
    subject: rendered.subject,
    text: rendered.bodyText,
    html: wrapHtmlBody(rendered.bodyHtml),
  });
  return { sent: true, alertItems: count, recipients: notify.to };
}

async function notifyHandoverCompleted(receipt) {
  try {
    const { smtp, notify, companyName } = await getMailConfig();
    if (!notify.enabled || !notify.handoverCompleted || !notify.to.length || !smtp.host) return;
    const emp = receipt.employee?.fullName || receipt.employee?.email || 'employee';
    const templates = await getEmailTemplates();
    const rendered = renderTemplate(templates.handover_completed, {
      companyName,
      employeeName: emp,
      itemCount: String(receipt.itemCount || 0),
      handoverId: String(receipt.handoverId || '—'),
      ackNote: receipt.ackToken
        ? 'An acknowledgement link was generated for the employee to confirm receipt.'
        : '',
      appUrl: appBaseUrl(),
    });
    await sendMail({
      to: notify.to,
      subject: rendered.subject,
      text: rendered.bodyText,
      html: wrapHtmlBody(rendered.bodyHtml),
    });
  } catch (err) {
    console.warn('[notify] handover email failed:', err.message);
  }
}

/**
 * Tell the new Owner that the instance was transferred. `credentials` is the
 * one bit the caller varies: existing accounts keep their password, freshly
 * created ones get a temporary one.
 */
async function sendOwnerTransferEmail({ to, username, credentials }) {
  const [{ companyName }, templates] = await Promise.all([getMailConfig(), getEmailTemplates()]);
  const rendered = renderTemplate(templates.owner_transfer, {
    companyName,
    employeeName: username || to,
    employeeEmail: to,
    credentials: credentials || '',
    appUrl: appBaseUrl(),
  });
  return sendMail({
    to,
    subject: rendered.subject,
    text: rendered.bodyText,
    html: wrapHtmlBody(rendered.bodyHtml),
  });
}

async function getEmailTemplates() {
  const { rows } = await query('SELECT email_templates FROM app_settings WHERE id = 1');
  return mergeTemplates(rows[0]?.email_templates || {});
}

async function saveEmailTemplates(body = {}) {
  const { rows } = await query('SELECT email_templates FROM app_settings WHERE id = 1');
  const stored = { ...(rows[0]?.email_templates && typeof rows[0].email_templates === 'object'
    ? rows[0].email_templates
    : {}) };

  const reset = Array.isArray(body.reset) ? body.reset : [];
  for (const key of reset) {
    if (TEMPLATE_KEYS.includes(key)) delete stored[key];
  }

  for (const key of TEMPLATE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(body, key) && body[key] != null) {
      stored[key] = sanitizeTemplateInput(key, body[key]);
    }
  }

  await query(
    'UPDATE app_settings SET email_templates = $1::jsonb WHERE id = 1',
    [JSON.stringify(stored)]
  );
  return getEmailTemplates();
}

function formatOnboardingItemList(items) {
  const lines = (items || []).map((it) => {
    if (it.kind === 'asset') {
      const name = [it.brand, it.model].filter(Boolean).join(' ');
      return `- ${it.assetTag || 'Asset'}${name ? `: ${name}` : ''}`;
    }
    const meta = [it.operator, it.plan].filter(Boolean).join(' · ');
    return `- Line: ${it.phoneNumber || '—'}${meta ? ` (${meta})` : ''}`;
  });
  return lines.length ? lines.join('\n') : '(none reserved yet)';
}

async function sendOnboardingWelcomeEmail({ onboardingId, to, extraNote } = {}) {
  const { smtp } = await getMailConfig();
  if (!smtp.host) {
    throw HttpError.badRequest('SMTP host is required — save SMTP settings first');
  }

  // Lazy require to avoid circular dependency with onboardingService / handover notify paths.
  const onboardingService = require('./onboardingService');
  const detail = await onboardingService.getOnboarding(onboardingId);

  const { rows } = await query(
    'SELECT company_name, company_address, email_templates FROM app_settings WHERE id = 1'
  );
  const companyName = rows[0]?.company_name || 'ITACM';
  const companyAddress = rows[0]?.company_address || '';
  const templates = mergeTemplates(rows[0]?.email_templates || {});
  const tpl = templates.onboarding_welcome;

  const emp = detail.employee || {};
  const employeeName = emp.fullName || emp.full_name || 'Employee';
  const employeeEmail = emp.email || '';
  const recipient = String(to || employeeEmail || '').trim().toLowerCase();
  if (!recipient) throw HttpError.badRequest('Recipient email is required');

  const appUrl = process.env.APP_URL || process.env.PUBLIC_URL || 'http://localhost:8000';
  const accessInstructions = String(extraNote || '').trim() || DEFAULT_ACCESS;
  const startDate = String(detail.startDate || '').slice(0, 10);

  const rendered = renderTemplate(tpl, {
    companyName,
    companyAddress,
    employeeName,
    employeeEmail,
    startDate,
    itemList: formatOnboardingItemList(detail.items),
    appUrl,
    accessInstructions,
  });

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>`
    + `<body style="font-family:system-ui,-apple-system,sans-serif;line-height:1.5;color:#1a1a1a;max-width:640px;margin:0 auto;padding:24px">`
    + `${rendered.bodyHtml}</body></html>`;

  await sendMail({
    to: recipient,
    subject: rendered.subject,
    text: rendered.bodyText,
    html,
  });

  return { sent: true, sentTo: recipient, subject: rendered.subject };
}

/**
 * Email a self-service Portal user their sign-in details (URL, email, temporary
 * password). Uses the editable `portal_access` template (Integrations →
 * Templates); renderTemplate HTML-escapes every variable, so untrusted names
 * cannot inject markup.
 */
async function sendPortalAccessEmail({ to, username, tempPassword }) {
  const [{ companyName }, templates] = await Promise.all([getMailConfig(), getEmailTemplates()]);
  const tpl = templates.portal_access;
  const appUrl = process.env.APP_URL || process.env.PUBLIC_URL || 'http://localhost:8000';

  const rendered = renderTemplate(tpl, {
    companyName,
    employeeName: username || to,
    employeeEmail: to,
    appUrl,
    tempPassword,
  });

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>`
    + `<body style="font-family:system-ui,-apple-system,sans-serif;line-height:1.5;color:#1a1a1a;max-width:640px;margin:0 auto;padding:24px">`
    + `${rendered.bodyHtml}</body></html>`;

  return sendMail({
    to,
    subject: rendered.subject,
    text: rendered.bodyText,
    html,
  });
}


async function sendHrRequestNotice(request) {
  try {
    const { smtp, notify, companyName } = await getMailConfig();
    if (!smtp.host) return { skipped: true, reason: 'smtp not configured' };

    let recipients = [];
    if (notify.enabled && Array.isArray(notify.to) && notify.to.length) {
      recipients = notify.to.slice();
    } else {
      const { rows } = await query(
        "SELECT email FROM users WHERE role IN ('Owner', 'Admin') AND status = 'Active' AND email IS NOT NULL"
      );
      recipients = rows.map((r) => String(r.email).trim().toLowerCase()).filter(Boolean);
    }
    if (!recipients.length) return { skipped: true, reason: 'no recipients' };

    const templates = await getEmailTemplates();
    const isOff = request && request.type === 'offboard';
    const tpl = isOff ? templates.hr_offboard_request : templates.hr_onboard_request;
    const appUrl = process.env.APP_URL || process.env.PUBLIC_URL || 'http://localhost:8000';
    const items = (request.items || []).map((it) => `- ${it.category} x${it.qty || 1}`).join('\n')
      || '(none)';
    const rendered = renderTemplate(tpl, {
      companyName,
      employeeName: request.fullName || '',
      employeeEmail: request.email || '',
      department: request.department || '—',
      eventDate: String(request.eventDate || '').slice(0, 10),
      itemList: items,
      notes: request.notes || '—',
      requestedBy: request.createdByName || 'HR',
      appUrl,
      requestType: isOff ? 'offboard' : 'onboard',
    });
    const html = '<!DOCTYPE html><html><head><meta charset="utf-8"></head>'
      + '<body style="font-family:system-ui,-apple-system,sans-serif;line-height:1.5;color:#1a1a1a;max-width:640px;margin:0 auto;padding:24px">'
      + `${rendered.bodyHtml}</body></html>`;
    await sendMail({
      to: recipients,
      subject: rendered.subject,
      text: rendered.bodyText,
      html,
    });
    return { sent: true, recipients };
  } catch (err) {
    console.warn('[notify] HR request email failed:', err.message);
    return { skipped: true, reason: err.message };
  }
}

module.exports = {
  getMailConfig, saveMailConfig, clearMailConfig, sendTestEmail, runAlertDigest, notifyHandoverCompleted, sendMail,
  getEmailTemplates, saveEmailTemplates, sendOnboardingWelcomeEmail, sendPortalAccessEmail, sendHrRequestNotice,
  sendOwnerTransferEmail,
  DEFAULT_NOTIFY, TEMPLATE_KEYS, PLACEHOLDERS,
};
