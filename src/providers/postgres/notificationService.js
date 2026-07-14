/** SMTP + alert digest notifications. */
const nodemailer = require('nodemailer');
const { query } = require('./pool');
const { HttpError } = require('../../utils/httpError');
const dashboardService = require('./dashboardService');
const { renderEmail } = require('../../utils/emailLayout');
const { encryptSecret, decryptSecret } = require('../../utils/secretCrypto');
const { resolveAndAssertPublicHost, smtpAllowsPrivate } = require('../../utils/safeOutbound');

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
  return {
    ...smtp,
    pass: decryptSecret(smtp.pass || ''),
  };
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
    // Empty / masked password = keep existing secret (never persist the UI placeholder).
    const nextPassPlain = isBlankOrMaskedPass(smtp.pass)
      ? (cur.smtp?.pass || '')
      : String(smtp.pass).slice(0, 200);
    const host = String(smtp.host || '').slice(0, 200);
    await assertSmtpHostSafe(host);
    params.push(JSON.stringify({
      host,
      port: Math.min(65535, Math.max(1, Number(smtp.port) || 587)),
      secure: !!smtp.secure,
      user: String(smtp.user || '').slice(0, 200),
      pass: encryptSecret(nextPassPlain),
      from: String(smtp.from || '').slice(0, 200),
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
  if (!smtp.host) throw HttpError.badRequest('SMTP host is required');
  const port = Number(smtp.port) || 587;
  const secure = smtp.secure != null ? !!smtp.secure : port === 465;
  const auth = smtp.user ? { user: smtp.user, pass: smtp.pass || '' } : undefined;
  return nodemailer.createTransport({
    host: smtp.host,
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

function mapSmtpError(err) {
  const msg = String(err?.message || err || '');
  const code = err?.code || err?.responseCode;
  const response = String(err?.response || '');
  if (/Invalid login|authentication failed|535/i.test(msg + response)
    || code === 535) {
    return HttpError.badRequest(
      'SMTP authentication failed. For iCloud/Gmail use an app-specific password '
      + '(not your normal account password), then Save SMTP and try again.'
    );
  }
  if (/ECONNREFUSED|ETIMEDOUT|ESOCKET|ENOTFOUND|ECONNRESET|connection timed out/i.test(msg)
    || code === 'ECONNECTION' || code === 'ETIMEDOUT' || code === 'EDNS') {
    return HttpError.badRequest(
      `Cannot reach SMTP server (${msg.slice(0, 120)}). Check host, port, and TLS (465 = TLS on).`
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
    throw mapSmtpError(err);
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

  const mail = renderEmail({
    companyName,
    eyebrow: 'Daily alert digest',
    title: `${count} item${count === 1 ? '' : 's'} need attention`,
    intro: 'Summary of expired licenses, low stock, EOL, and onboarding due in your workspace.',
    meta: [
      { label: 'Workspace', value: companyName },
      { label: 'Alert total', value: String(count) },
    ],
    sections,
    footerNote: `${companyName} · ITACM digest · open the app to act on these items`,
  });

  await sendMail({
    to: notify.to,
    subject: `[ITACM] ${count} alert(s) — ${companyName}`,
    text: mail.text,
    html: mail.html,
  });
  return { sent: true, alertItems: count, recipients: notify.to };
}

async function notifyHandoverCompleted(receipt) {
  try {
    const { smtp, notify, companyName } = await getMailConfig();
    if (!notify.enabled || !notify.handoverCompleted || !notify.to.length || !smtp.host) return;
    const emp = receipt.employee?.fullName || receipt.employee?.email || 'employee';
    const ackUrl = receipt.ackToken
      ? `(ack token issued — share /ack.html?token=… with employee)`
      : null;
    const mail = renderEmail({
      companyName,
      eyebrow: 'Handover / zimmet',
      title: 'Handover completed',
      intro: `Equipment was assigned to ${emp}. A receipt is available in Handover Ops.`,
      meta: [
        { label: 'Employee', value: emp },
        { label: 'Items', value: String(receipt.itemCount || 0) },
        { label: 'Handover ID', value: String(receipt.handoverId || '—') },
      ].concat(ackUrl ? [{ label: 'Acknowledgement', value: 'Ack link generated for employee confirmation' }] : []),
      footerNote: `${companyName} · ITACM handover notification`,
    });
    await sendMail({
      to: notify.to,
      subject: `[ITACM] Handover completed — ${emp}`,
      text: mail.text,
      html: mail.html,
    });
  } catch (err) {
    console.warn('[notify] handover email failed:', err.message);
  }
}

module.exports = {
  getMailConfig, saveMailConfig, clearMailConfig, sendTestEmail, runAlertDigest, notifyHandoverCompleted, sendMail,
  DEFAULT_NOTIFY,
};
