/**
 * Editable email templates stored in app_settings.email_templates.
 * Missing keys fall back to DEFAULT_EMAIL_TEMPLATES.
 */

const TEMPLATE_KEYS = [
  'onboarding_welcome', 'portal_access', 'hr_onboard_request', 'hr_offboard_request',
  'handover_completed', 'alert_digest', 'owner_transfer',
];

/** Shown in the template picker so the list reads as flows, not as keys. */
const TEMPLATE_LABELS = {
  onboarding_welcome: 'Onboarding — welcome email to the new employee',
  portal_access: 'Portal access — sign-in details for the employee',
  hr_onboard_request: 'HR request — onboarding submitted to IT',
  hr_offboard_request: 'HR request — offboarding submitted to IT',
  handover_completed: 'Handover completed — notice to IT recipients',
  alert_digest: 'Daily alert digest — licenses, stock, EOL, onboarding',
  owner_transfer: 'Ownership transfer — notice to the new owner',
};

const PLACEHOLDERS = [
  'companyName', 'companyAddress', 'employeeName', 'employeeEmail',
  'startDate', 'itemList', 'appUrl', 'accessInstructions',
];

// Placeholders each template actually supports (shown in the editor UI).
const TEMPLATE_PLACEHOLDERS = {
  onboarding_welcome: PLACEHOLDERS,
  portal_access: ['companyName', 'employeeName', 'employeeEmail', 'appUrl', 'tempPassword'],
  hr_onboard_request: ['companyName', 'employeeName', 'employeeEmail', 'department', 'eventDate', 'itemList', 'notes', 'requestedBy', 'appUrl', 'requestType'],
  hr_offboard_request: ['companyName', 'employeeName', 'employeeEmail', 'department', 'eventDate', 'notes', 'requestedBy', 'appUrl', 'requestType'],
  handover_completed: ['companyName', 'employeeName', 'itemCount', 'handoverId', 'ackNote', 'appUrl'],
  alert_digest: ['companyName', 'alertCount', 'alertSummary', 'appUrl'],
  owner_transfer: ['companyName', 'employeeName', 'employeeEmail', 'credentials', 'appUrl'],
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
  hr_onboard_request: {
    subject: '[ITACM] HR onboard request — {{employeeName}} ({{eventDate}})',
    bodyHtml:
      '<p>A new <strong>onboarding</strong> request was submitted for IT.</p>'
      + '<p><strong>Employee:</strong> {{employeeName}} &lt;{{employeeEmail}}&gt;<br>'
      + '<strong>Department:</strong> {{department}}<br>'
      + '<strong>Start date:</strong> {{eventDate}}<br>'
      + '<strong>Requested by:</strong> {{requestedBy}}</p>'
      + '<p><strong>Equipment checklist</strong></p>'
      + '<pre style="font-family:inherit;white-space:pre-wrap;margin:0">{{itemList}}</pre>'
      + '<p><strong>Notes</strong><br>{{notes}}</p>'
      + '<p>Open the dashboard: <a href="{{appUrl}}">{{appUrl}}</a></p>',
    bodyText:
      'A new onboarding request was submitted for IT.\n\n'
      + 'Employee: {{employeeName}} <{{employeeEmail}}>\n'
      + 'Department: {{department}}\n'
      + 'Start date: {{eventDate}}\n'
      + 'Requested by: {{requestedBy}}\n\n'
      + 'Equipment checklist:\n{{itemList}}\n\n'
      + 'Notes:\n{{notes}}\n\n'
      + 'Open: {{appUrl}}\n',
  },
  hr_offboard_request: {
    subject: '[ITACM] HR offboard request — {{employeeName}} ({{eventDate}})',
    bodyHtml:
      '<p>A new <strong>offboarding</strong> request was submitted for IT.</p>'
      + '<p><strong>Employee:</strong> {{employeeName}} &lt;{{employeeEmail}}&gt;<br>'
      + '<strong>Department:</strong> {{department}}<br>'
      + '<strong>Last day:</strong> {{eventDate}}<br>'
      + '<strong>Requested by:</strong> {{requestedBy}}</p>'
      + '<p><strong>Notes</strong><br>{{notes}}</p>'
      + '<p>Run the real offboard flow in the app when ready. Dashboard: <a href="{{appUrl}}">{{appUrl}}</a></p>',
    bodyText:
      'A new offboarding request was submitted for IT.\n\n'
      + 'Employee: {{employeeName}} <{{employeeEmail}}>\n'
      + 'Department: {{department}}\n'
      + 'Last day: {{eventDate}}\n'
      + 'Requested by: {{requestedBy}}\n\n'
      + 'Notes:\n{{notes}}\n\n'
      + 'Run the real offboard flow in the app when ready.\n'
      + 'Open: {{appUrl}}\n',
  },
  handover_completed: {
    subject: '[ITACM] Handover completed — {{employeeName}}',
    bodyHtml:
      '<p>Equipment was handed over to <strong>{{employeeName}}</strong>.</p>'
      + '<p><strong>Items:</strong> {{itemCount}}<br>'
      + '<strong>Handover ID:</strong> {{handoverId}}<br>'
      + '<strong>Company:</strong> {{companyName}}</p>'
      + '<p>{{ackNote}}</p>'
      + '<p>The receipt is available in Handover Ops: <a href="{{appUrl}}">{{appUrl}}</a></p>',
    bodyText:
      'Equipment was handed over to {{employeeName}}.\n\n'
      + 'Items: {{itemCount}}\n'
      + 'Handover ID: {{handoverId}}\n'
      + 'Company: {{companyName}}\n\n'
      + '{{ackNote}}\n\n'
      + 'The receipt is available in Handover Ops: {{appUrl}}\n',
  },
  alert_digest: {
    subject: '[ITACM] {{alertCount}} alert(s) — {{companyName}}',
    bodyHtml:
      '<p><strong>{{alertCount}}</strong> item(s) need attention in <strong>{{companyName}}</strong>.</p>'
      + '<p>Expired licenses, low stock, end-of-life hardware and onboardings that are due:</p>'
      + '<pre style="font-family:inherit;white-space:pre-wrap;margin:0">{{alertSummary}}</pre>'
      + '<p>Open the app to act on these items: <a href="{{appUrl}}">{{appUrl}}</a></p>',
    bodyText:
      '{{alertCount}} item(s) need attention in {{companyName}}.\n\n'
      + '{{alertSummary}}\n\n'
      + 'Open the app to act on these items: {{appUrl}}\n',
  },
  owner_transfer: {
    subject: 'You are now the owner of {{companyName}}',
    bodyHtml:
      '<p>Hello {{employeeName}},</p>'
      + '<p>You are now the <strong>Owner</strong> of this IT Asset Control instance ({{companyName}}).</p>'
      + '<p>{{credentials}}</p>'
      + '<p>Set up two-factor authentication when prompted.</p>'
      + '<p>Sign in: <a href="{{appUrl}}">{{appUrl}}</a></p>',
    bodyText:
      'Hello {{employeeName}},\n\n'
      + 'You are now the Owner of this IT Asset Control instance ({{companyName}}).\n\n'
      + '{{credentials}}\n\n'
      + 'Set up two-factor authentication when prompted.\n\n'
      + 'Sign in: {{appUrl}}\n',
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
      // Shipped with the payload so the editor lists whatever the server
      // supports instead of a copy of this list that drifts out of sync.
      label: TEMPLATE_LABELS[key] || key,
      placeholders: TEMPLATE_PLACEHOLDERS[key] || PLACEHOLDERS,
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
  TEMPLATE_LABELS,
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
