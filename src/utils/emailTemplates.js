/**
 * Editable email templates stored in app_settings.email_templates.
 * Missing keys fall back to DEFAULT_EMAIL_TEMPLATES.
 */

const TEMPLATE_KEYS = ['onboarding_welcome', 'portal_access'];

const PLACEHOLDERS = [
  'companyName', 'companyAddress', 'employeeName', 'employeeEmail',
  'startDate', 'itemList', 'appUrl', 'accessInstructions',
];

// Placeholders each template actually supports (shown in the editor UI).
const TEMPLATE_PLACEHOLDERS = {
  onboarding_welcome: PLACEHOLDERS,
  portal_access: ['companyName', 'employeeName', 'employeeEmail', 'appUrl', 'tempPassword'],
};

const DEFAULT_EMAIL_TEMPLATES = {
  onboarding_welcome: {
    subject: 'Welcome to {{companyName}} — your start date {{startDate}}',
    bodyHtml:
      '<p>Hello {{employeeName}},</p>'
      + '<p>Welcome to <strong>{{companyName}}</strong>. Your start date is <strong>{{startDate}}</strong>.</p>'
      + '<p><strong>Company</strong><br>{{companyName}}<br>{{companyAddress}}</p>'
      + '<p><strong>Reserved for your first day</strong></p>'
      + '<pre style="font-family:inherit;white-space:pre-wrap;margin:0">{{itemList}}</pre>'
      + '<p><strong>How to get access / Giriş bilgileri</strong></p>'
      + '<p>{{accessInstructions}}</p>'
      + '<p>Workspace: <a href="{{appUrl}}">{{appUrl}}</a></p>'
      + '<p>If you have questions, reply to this email or contact IT.</p>',
    bodyText:
      'Hello {{employeeName}},\n\n'
      + 'Welcome to {{companyName}}. Your start date is {{startDate}}.\n\n'
      + 'Company:\n{{companyName}}\n{{companyAddress}}\n\n'
      + 'Reserved for your first day:\n{{itemList}}\n\n'
      + 'How to get access / Giriş bilgileri:\n{{accessInstructions}}\n\n'
      + 'Workspace: {{appUrl}}\n\n'
      + 'If you have questions, reply to this email or contact IT.\n',
  },
  portal_access: {
    subject: 'Your {{companyName}} account',
    bodyHtml:
      '<p>Hello {{employeeName}},</p>'
      + '<p>You can now sign in to <strong>{{companyName}}</strong> to view the equipment assigned to you (zimmet).</p>'
      + '<p><strong>Sign-in URL:</strong> <a href="{{appUrl}}">{{appUrl}}</a><br>'
      + '<strong>Email:</strong> {{employeeEmail}}<br>'
      + '<strong>Temporary password:</strong> {{tempPassword}}</p>'
      + '<p>Please change your password right after your first sign-in.</p>'
      + '<p>{{companyName}} · ITACM</p>',
    bodyText:
      'Hello {{employeeName}},\n\n'
      + 'You can now sign in to {{companyName}} to view the equipment assigned to you (zimmet).\n\n'
      + 'Sign-in URL: {{appUrl}}\n'
      + 'Email: {{employeeEmail}}\n'
      + 'Temporary password: {{tempPassword}}\n\n'
      + 'Please change your password right after your first sign-in.\n\n'
      + '{{companyName}} · ITACM\n',
  },
};

const DEFAULT_ACCESS =
  'Your IT team will share login details for email, VPN, and workplace tools on your start day. '
  + 'Keep this message for reference.';

function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function stripScripts(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*(['"]).*?\1/gi, '')
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, '');
}

function getDefaultTemplate(key) {
  const d = DEFAULT_EMAIL_TEMPLATES[key];
  if (!d) return null;
  return { subject: d.subject, bodyHtml: d.bodyHtml, bodyText: d.bodyText };
}

function mergeTemplates(stored) {
  const out = {};
  for (const key of TEMPLATE_KEYS) {
    const def = getDefaultTemplate(key);
    const raw = stored && typeof stored === 'object' ? stored[key] : null;
    out[key] = {
      subject: String((raw && raw.subject) || def.subject).slice(0, 200),
      bodyHtml: String((raw && raw.bodyHtml) || def.bodyHtml).slice(0, 50000),
      bodyText: String((raw && raw.bodyText) || def.bodyText).slice(0, 20000),
      isCustom: !!(raw && (raw.subject || raw.bodyHtml || raw.bodyText)),
    };
  }
  return out;
}

function sanitizeTemplateInput(key, input) {
  if (!TEMPLATE_KEYS.includes(key)) {
    const err = new Error(`Unknown template key: ${key}`);
    err.status = 400;
    throw err;
  }
  const def = getDefaultTemplate(key);
  const src = input && typeof input === 'object' ? input : {};
  return {
    subject: String(src.subject != null ? src.subject : def.subject).trim().slice(0, 200) || def.subject,
    bodyHtml: stripScripts(String(src.bodyHtml != null ? src.bodyHtml : def.bodyHtml)).slice(0, 50000),
    bodyText: String(src.bodyText != null ? src.bodyText : def.bodyText).slice(0, 20000),
  };
}

function applyVars(template, vars, { html = false } = {}) {
  let out = String(template ?? '');
  for (const [k, v] of Object.entries(vars || {})) {
    const raw = v == null ? '' : String(v);
    const val = html ? escHtml(raw) : raw;
    out = out.split(`{{${k}}}`).join(val);
  }
  // Leave unknown placeholders visible rather than deleting them.
  return out;
}

function renderTemplate(tpl, vars) {
  const subject = applyVars(tpl.subject, vars, { html: false }).slice(0, 200);
  const bodyHtml = applyVars(tpl.bodyHtml, vars, { html: true });
  const bodyText = applyVars(tpl.bodyText || tpl.bodyHtml.replace(/<[^>]+>/g, ' '), vars, { html: false });
  return { subject, bodyHtml, bodyText };
}

module.exports = {
  TEMPLATE_KEYS,
  PLACEHOLDERS,
  TEMPLATE_PLACEHOLDERS,
  DEFAULT_EMAIL_TEMPLATES,
  DEFAULT_ACCESS,
  getDefaultTemplate,
  mergeTemplates,
  sanitizeTemplateInput,
  renderTemplate,
  applyVars,
};
