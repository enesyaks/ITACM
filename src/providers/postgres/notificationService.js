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
const { shouldRunDigest, ymd } = require('../../utils/digestSchedule');

/**
 * Where links in templated mail point. Prefers the admin-set public URL
 * (Integrations → Notifications), then the APP_URL / PUBLIC_URL env fallback,
 * then localhost. `notify` is the loaded notification config (carries appUrl).
 */
function appBaseUrl(notify) {
  const stored = notify && typeof notify.appUrl === 'string' ? notify.appUrl.trim() : '';
  return stored || process.env.APP_URL || process.env.PUBLIC_URL || 'http://localhost:8000';
}

/** Validate + normalize an admin-entered public app URL. Empty = use fallback. */
function cleanAppUrl(raw) {
  const s = String(raw == null ? '' : raw).trim().slice(0, 200);
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) throw HttpError.badRequest('App URL must start with http:// or https://');
  let u;
  try { u = new URL(s); } catch { throw HttpError.badRequest('App URL is not a valid URL'); }
  const path = u.pathname && u.pathname !== '/' ? u.pathname.replace(/\/+$/, '') : '';
  return u.origin + path;
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
  ticketUpdates: false,
  // Automatic digest schedule: 'off' | 'daily' | 'weekly'. `hour` is server
  // local time (0-23); `weekday` (0=Sun) applies only to the weekly cadence.
  // `lastRunDate` is server-managed (YYYY-MM-DD) and guards once-per-day sends.
  schedule: 'off',
  hour: 8,
  weekday: 1,
  lastRunDate: null,
  // Public URL this instance is reached at, used for links in outbound mail.
  // Empty = fall back to APP_URL / PUBLIC_URL env, then localhost.
  appUrl: '',
};

const SCHEDULE_MODES = ['off', 'daily', 'weekly'];

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

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
    'SELECT smtp_json, notify_json, company_name, company_logo, company_address FROM app_settings WHERE id = 1'
  );
  const smtp = materializeSmtp(rows[0]?.smtp_json || {});
  const notify = { ...DEFAULT_NOTIFY, ...(rows[0]?.notify_json || {}) };
  return {
    smtp, notify,
    companyName: rows[0]?.company_name || 'ITACM',
    companyLogo: rows[0]?.company_logo || null,
    companyAddress: rows[0]?.company_address || null,
  };
}

// A company logo (stored as a data:image URI) → an inline CID attachment, which
// email clients render reliably (unlike data: URIs, which most of them block).
function logoAttachment(companyLogo) {
  if (!companyLogo || typeof companyLogo !== 'string') return null;
  const m = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(companyLogo.trim());
  if (!m) return null;
  try {
    const ext = (m[1].split('/')[1] || 'png').replace('+xml', '').replace('svg', 'svg');
    return { filename: 'logo.' + ext, content: Buffer.from(m[2], 'base64'), cid: 'companylogo', contentType: m[1] };
  } catch { return null; }
}

function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
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
    const schedule = SCHEDULE_MODES.includes(notify.schedule) ? notify.schedule : 'off';
    // `lastRunDate` is never set from the client — preserve whatever the
    // scheduler last stamped so saving settings can't re-trigger a same-day send.
    const prevNotify = (await getMailConfig()).notify;
    params.push(JSON.stringify({
      enabled: !!notify.enabled,
      to,
      lowStock: notify.lowStock !== false,
      licenseExpiry: notify.licenseExpiry !== false,
      licenseExpired: notify.licenseExpired !== false,
      eol: notify.eol !== false,
      onboarding: notify.onboarding !== false,
      handoverCompleted: !!notify.handoverCompleted,
      ticketUpdates: !!notify.ticketUpdates,
      schedule,
      hour: clampInt(notify.hour, 0, 23, 8),
      weekday: clampInt(notify.weekday, 0, 6, 1),
      lastRunDate: prevNotify.lastRunDate || null,
      appUrl: notify.appUrl !== undefined ? cleanAppUrl(notify.appUrl) : (prevNotify.appUrl || ''),
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
    // Kept short so an unreachable/misconfigured server fails fast on the
    // interactive paths (grant portal access, test email) instead of leaving
    // the UI hanging on a long TCP/greeting wait.
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 12000,
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

async function sendMail({ to, subject, text, html, attachments }) {
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
      attachments: (Array.isArray(attachments) && attachments.length) ? attachments : undefined,
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
    appUrl: appBaseUrl(notify),
  });

  await sendMail({
    to: notify.to,
    subject: rendered.subject,
    text: rendered.bodyText,
    html: wrapHtmlBody(rendered.bodyHtml),
  });
  return { sent: true, alertItems: count, recipients: notify.to };
}

/** Stamp today's date into notify_json without disturbing the other toggles. */
async function recordDigestRun(dateStr) {
  await query(
    `UPDATE app_settings
        SET notify_json = jsonb_set(COALESCE(notify_json, '{}'::jsonb), '{lastRunDate}', to_jsonb($1::text), true)
      WHERE id = 1`,
    [dateStr]
  );
}

/**
 * Scheduler entry point — called on a fixed interval. Runs the digest only when
 * the configured daily/weekly cadence lands on this tick, then records the run
 * date first so a slow send or restart cannot double-fire the same day.
 */
async function runScheduledDigest(now = new Date()) {
  const { notify } = await getMailConfig();
  if (!shouldRunDigest(notify, now)) return { skipped: true, reason: 'not scheduled' };
  await recordDigestRun(ymd(now));
  return runAlertDigest();
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
      appUrl: appBaseUrl(notify),
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
  const [{ companyName, notify }, templates] = await Promise.all([getMailConfig(), getEmailTemplates()]);
  const rendered = renderTemplate(templates.owner_transfer, {
    companyName,
    employeeName: username || to,
    employeeEmail: to,
    credentials: credentials || '',
    appUrl: appBaseUrl(notify),
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
/**
 * One transactional ticket notification (reply / status change / assignment).
 * Gated on notifications being enabled AND the `ticketUpdates` toggle. Always
 * resolves (never throws) so the caller can fire-and-forget: SMTP problems and
 * a disabled feature both come back as `{ skipped }`.
 */
/**
 * Branded, table-based HTML shell wrapping an editable template's body fragment.
 * Renders a header band (company logo via CID, or the company name), a white
 * content card and a footer. `opts`: { companyName, hasLogo, address }.
 */
function templateHtml(bodyHtml, opts = {}) {
  const BRAND = '#3525cd';
  const companyName = escHtml(opts.companyName || 'ITACM');
  const brandCell = opts.hasLogo
    ? `<img src="cid:companylogo" alt="${companyName}" height="40" style="height:40px;max-width:220px;display:block;border:0;outline:none;text-decoration:none">`
    : `<div style="font-size:20px;font-weight:800;color:#ffffff;letter-spacing:.2px">${companyName}</div>`;
  const address = opts.address ? ` &middot; ${escHtml(opts.address)}` : '';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:0;background:#f4f4f9;-webkit-font-smoothing:antialiased;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f9;padding:24px 12px">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 2px rgba(24,23,48,.05),0 10px 28px rgba(24,23,48,.06)">
        <tr><td style="background:${BRAND};padding:22px 30px">${brandCell}</td></tr>
        <tr><td style="padding:30px 30px 12px;color:#1a1830;font-size:15px;line-height:1.65">${bodyHtml}</td></tr>
        <tr><td style="border-top:1px solid #ececf4;padding:18px 30px 24px;color:#8a889c;font-size:12px;line-height:1.6">
          <strong style="color:#6c6a80">${companyName}</strong>${address}<br>
          <span style="color:#b0aec4">Bu e-posta ITACM · IT Asset Control Pro tarafından gönderildi.</span>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

/**
 * SLA escalation. Its own template rather than a ticket_update with a different
 * {{event}} string: a breach carries facts an update does not — which leg, when
 * it was due, how late it is — and a desk wants to word that mail differently
 * from "someone replied". Returns the same {skipped, reason} shape as the other
 * senders so the caller can record WHY nothing went out.
 */
async function sendSlaBreachNotification({ to, ticketNumber, subject, slaType, dueAt, overdueBy, priority, assigneeName }) {
  try {
    if (!to) return { skipped: true, reason: 'no recipient' };
    const { notify, smtp, companyName, companyLogo, companyAddress } = await getMailConfig();
    if (!notify.enabled || !notify.ticketUpdates) return { skipped: true, reason: 'ticket notifications off' };
    if (!smtp.host) return { skipped: true, reason: 'no smtp host' };
    const base = appBaseUrl(notify) || process.env.APP_URL || 'http://localhost:8000';
    const templates = await getEmailTemplates();
    const rendered = renderTemplate(templates.sla_breach, {
      companyName, ticketNumber, subject,
      slaType: slaType || 'SLA', dueAt: dueAt || '-', overdueBy: overdueBy || '-',
      priority: priority || '-', assigneeName: assigneeName || 'nobody', appUrl: base,
    });
    const logo = logoAttachment(companyLogo);
    return await sendMail({ to, subject: rendered.subject, text: rendered.bodyText,
      html: templateHtml(rendered.bodyHtml, { companyName, hasLogo: !!logo, address: companyAddress }),
      attachments: logo ? [logo] : undefined });
  } catch (err) {
    return { skipped: true, reason: err.message };
  }
}

async function sendTicketNotification({ to, ticketNumber, subject, event, actorName, snippet }) {
  try {
    if (!to) return { skipped: true, reason: 'no recipient' };
    const { notify, smtp, companyName, companyLogo, companyAddress } = await getMailConfig();
    if (!notify.enabled || !notify.ticketUpdates) return { skipped: true, reason: 'ticket notifications off' };
    if (!smtp.host) return { skipped: true, reason: 'no smtp host' };
    const base = appBaseUrl(notify) || process.env.APP_URL || 'http://localhost:8000';
    const templates = await getEmailTemplates();
    const rendered = renderTemplate(templates.ticket_update, {
      companyName, ticketNumber, subject, event,
      actorName: actorName || 'Someone', snippet: snippet ? `"${snippet}"` : '', appUrl: base,
    });
    const logo = logoAttachment(companyLogo);
    return await sendMail({ to, subject: rendered.subject, text: rendered.bodyText,
      html: templateHtml(rendered.bodyHtml, { companyName, hasLogo: !!logo, address: companyAddress }),
      attachments: logo ? [logo] : undefined });
  } catch (err) {
    return { skipped: true, reason: err.message };
  }
}

/**
 * Notify the pending approver(s) that a request awaits their decision. Handles
 * both single-approver and parallel steps, and a `reminder` variant used by the
 * scheduler for requests left pending too long. Best-effort: never throws.
 */
async function sendApprovalNotice(request, { reminder = false } = {}) {
  try {
    if (!request) return { skipped: true, reason: 'no request' };
    const ids = [];
    if (request.approverEmployeeId) ids.push(request.approverEmployeeId);
    if (Array.isArray(request.stepState)) {
      for (const e of request.stepState) if (e && e.status === 'pending' && e.employeeId) ids.push(e.employeeId);
    }
    if (!ids.length) return { skipped: true, reason: 'no approver' };
    const { rows } = await query('SELECT id, email FROM employees WHERE id = ANY($1)', [[...new Set(ids)]]);
    const recipients = rows.filter((r) => r.email);
    if (!recipients.length) return { skipped: true, reason: 'approver has no email' };
    const { smtp, companyName, companyLogo, companyAddress, notify } = await getMailConfig();
    if (!smtp.host) return { skipped: true, reason: 'no smtp host' };
    const base = appBaseUrl(notify) || process.env.APP_URL || 'http://localhost:8000';
    const templates = await getEmailTemplates();
    const rendered = renderTemplate(templates.approval_request, {
      companyName,
      summary: request.summary || 'Approval needed',
      requesterName: request.requesterName || 'A requester',
      resourceRef: request.resourceRef ? ` (${request.resourceRef})` : '',
      appUrl: base,
    });
    const subject = reminder ? `[Reminder] ${rendered.subject}` : rendered.subject;
    const logo = logoAttachment(companyLogo);
    const html = templateHtml(rendered.bodyHtml, { companyName, hasLogo: !!logo, address: companyAddress });
    const results = [];
    for (const r of recipients) {
      results.push(await sendMail({ to: r.email, subject, text: rendered.bodyText, html, attachments: logo ? [logo] : undefined }));
    }
    return { sent: results.length };
  } catch (err) {
    return { skipped: true, reason: err.message };
  }
}

/** Email the requester that their request was approved/rejected (editable template). */
async function sendApprovalDecisionEmail(request, { decision, deciderName } = {}) {
  try {
    if (!request || !request.requesterEmployeeId) return { skipped: true, reason: 'no requester' };
    const { rows } = await query('SELECT email FROM employees WHERE id = $1', [request.requesterEmployeeId]);
    const to = rows[0] && rows[0].email;
    if (!to) return { skipped: true, reason: 'requester has no email' };
    const { smtp, companyName, companyLogo, companyAddress, notify } = await getMailConfig();
    if (!smtp.host) return { skipped: true, reason: 'no smtp host' };
    const base = appBaseUrl(notify) || process.env.APP_URL || 'http://localhost:8000';
    const templates = await getEmailTemplates();
    const rendered = renderTemplate(templates.approval_decision, {
      companyName,
      summary: request.summary || 'Your request',
      decision: decision === 'approved' ? 'approved' : 'rejected',
      deciderName: deciderName ? `Decided by ${deciderName}.` : '',
      appUrl: base,
    });
    const logo = logoAttachment(companyLogo);
    return await sendMail({ to, subject: rendered.subject, text: rendered.bodyText,
      html: templateHtml(rendered.bodyHtml, { companyName, hasLogo: !!logo, address: companyAddress }),
      attachments: logo ? [logo] : undefined });
  } catch (err) {
    return { skipped: true, reason: err.message };
  }
}

/**
 * `tempPassword` is null for a directory-backed account: there is no password
 * to hand over, so the mail tells the person to use the one they already have.
 */
async function sendPortalAccessEmail({ to, username, tempPassword, directory = false }) {
  const [{ companyName }, templates] = await Promise.all([getMailConfig(), getEmailTemplates()]);
  const tpl = templates.portal_access;
  const appUrl = process.env.APP_URL || process.env.PUBLIC_URL || 'http://localhost:8000';

  const rendered = renderTemplate(tpl, {
    companyName,
    employeeName: username || to,
    employeeEmail: to,
    appUrl,
    // The template's {{tempPassword}} slot carries the instruction instead of a
    // secret, so a directory account gets a mail that makes sense without
    // needing a second template to drift out of sync with the first.
    tempPassword: tempPassword || (directory ? '— (kurumsal / AD parolanız · your work account password)' : ''),
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
  getMailConfig, saveMailConfig, clearMailConfig, sendTestEmail, runAlertDigest, runScheduledDigest, notifyHandoverCompleted, sendMail,
  getEmailTemplates, saveEmailTemplates, sendOnboardingWelcomeEmail, sendPortalAccessEmail, sendHrRequestNotice,
  sendTicketNotification, sendSlaBreachNotification, sendApprovalNotice, sendApprovalDecisionEmail,
  sendOwnerTransferEmail,
  DEFAULT_NOTIFY, TEMPLATE_KEYS, PLACEHOLDERS,
};
