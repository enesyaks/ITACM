const express = require('express');
const router = express.Router();
const { authenticate, requireRole, requirePermission, requireScope } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const {
  notificationService, webhookService, customFieldService,
  apiKeyService, syncService, providerService, permissionService, settingsService,
} = require('../services');
const { HttpError } = require('../utils/httpError');

// Custom-field values inherit the underlying entity's read permission. Without
// this, any authenticated caller (low-priv user or API key) could read them by
// guessing entity IDs. entity ∈ {asset, employee, contract} maps 1:1 to an IAM
// resource; contract additionally goes through confidential-aware access.
async function assertEntityAccess(entity, entityId, user) {
  if (entity === 'contract') {
    await providerService.getContract(entityId, { user });
    return;
  }
  const allowed = await permissionService.checkPermission(user, entity, 'read');
  if (!allowed) {
    throw HttpError.forbidden(`Access denied: insufficient permissions for ${entity}:read`);
  }
}

/** ---------- Mail / digest (integration:read / integration:manage) ---------- */
function publicMailConfig(cfg) {
  if (!cfg || !cfg.smtp) return cfg;
  const s = cfg.smtp;
  return {
    ...cfg,
    smtp: {
      host: s.host || '',
      port: s.port || 587,
      user: s.user || '',
      from: s.from || '',
      secure: !!s.secure,
      pass: (s.passConfigured || s.pass) ? '••••••••' : '',
      passConfigured: !!(s.passConfigured || s.pass),
      passCorrupt: !!s.passCorrupt,
      authMethod: ['oauth2_ms', 'oauth2_delegated'].includes(s.authMethod) ? s.authMethod : 'password',
      oauthTenant: s.oauthTenant || '',
      oauthClientId: s.oauthClientId || '',
      oauthClientSecret: s.oauthSecretConfigured ? '••••••••' : '',
      oauthSecretConfigured: !!s.oauthSecretConfigured,
    },
  };
}

router.get('/notifications', authenticate, requirePermission('integration', 'read'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: publicMailConfig(await notificationService.getMailConfig()) });
}));

router.put('/notifications', authenticate, requirePermission('integration', 'manage'), asyncHandler(async (req, res) => {
  const body = req.body || {};
  res.json({ success: true, data: publicMailConfig(await notificationService.saveMailConfig(body)) });
}));

router.post('/notifications/test', authenticate, requirePermission('integration', 'manage'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await notificationService.sendTestEmail(req.body?.to) });
}));

// SSO (OIDC) configuration — secret is write-only (never returned).
const ssoService = require('../providers/postgres/ssoService');
router.get('/sso', authenticate, requirePermission('integration', 'read'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await ssoService.getSsoForUi() });
}));
router.put('/sso', authenticate, requirePermission('integration', 'manage'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await ssoService.saveSsoConfig(req.body || {}, req.user) });
}));
// Verify the provider is reachable (OIDC discovery) without performing a login.
router.post('/sso/test', authenticate, requirePermission('integration', 'manage'), asyncHandler(async (req, res) => {
  const cfg = await ssoService.getSsoConfig();
  res.json({ success: true, data: await require('../utils/oidc').discover(cfg) });
}));

/* ---- Directory (Active Directory / LDAP) — bind password is write-only ---- */
const ldapService = require('../providers/postgres/ldapService');

router.get('/ldap', authenticate, requirePermission('integration', 'read'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await ldapService.getForUi() });
}));
router.put('/ldap', authenticate, requirePermission('integration', 'manage'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await ldapService.saveConfig(req.body || {}, req.user) });
}));
// Bind with the service account and read a few people back — no writes.
router.post('/ldap/test', authenticate, requirePermission('integration', 'manage'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await ldapService.testConnection() });
}));
// Dry run: what a sync would create / update / deactivate, nothing written.
router.post('/ldap/preview', authenticate, requirePermission('integration', 'manage'), asyncHandler(async (req, res) => {
  const actorName = (req.user && (req.user.username || req.user.email)) || null;
  res.json({ success: true, data: await ldapService.runSync({ dryRun: true, trigger: 'preview', actorName, user: req.user }) });
}));
// The real thing. Creates and updates employees / IT accounts; audited.
router.post('/ldap/sync', authenticate, requirePermission('integration', 'manage'), asyncHandler(async (req, res) => {
  const actorName = (req.user && (req.user.username || req.user.email)) || null;
  res.json({ success: true, data: await ldapService.runSync({ trigger: 'manual', actorName, user: req.user }) });
}));
router.get('/ldap/runs', authenticate, requirePermission('integration', 'read'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await ldapService.listRuns(req.query.limit) });
}));

/** ---------- Email-to-ticket / inbound IMAP (integration:read / manage) ---------- */
const inboundMailService = require('../providers/postgres/inboundMailService');
router.get('/inbound-mail', authenticate, requirePermission('integration', 'read'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await inboundMailService.getConfig() });
}));
router.put('/inbound-mail', authenticate, requirePermission('integration', 'manage'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await inboundMailService.saveConfig(req.body || {}) });
}));
router.post('/inbound-mail/test', authenticate, requirePermission('integration', 'manage'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await inboundMailService.testConnection(req.body || {}) });
}));
// The mailbox's own folder list, so the folder can be picked instead of typed.
// POST, not GET: it carries the same unsaved-form fields the test does, and they
// must not end up in a URL or a proxy log. Same permission as the test.
router.post('/inbound-mail/folders', authenticate, requirePermission('integration', 'manage'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await inboundMailService.listFolders(req.body || {}) });
}));
// Fetch new mail right now instead of waiting for the scheduler.
router.post('/inbound-mail/poll', authenticate, requirePermission('integration', 'manage'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await inboundMailService.poll() });
}));
// Sender blocklist + the bulk-mail switch. Kept off the connection form so
// editing one can never overwrite the other.
router.get('/inbound-mail/blocklist', authenticate, requirePermission('integration', 'read'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await inboundMailService.getBlocklist() });
}));
router.put('/inbound-mail/blocklist', authenticate, requirePermission('integration', 'manage'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await inboundMailService.saveBlocklist(req.body || {}) });
}));
// Open a ticket from a message a filter had skipped — re-fetches it by mailbox id
// and processes it with the filters bypassed.
router.post('/inbound-mail/release', authenticate, requirePermission('integration', 'manage'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await inboundMailService.release((req.body || {}).messageId) });
}));

// ---- Delegated ("Connect mailbox") OAuth2: Microsoft / Google ----
const mailOAuthService = require('../providers/postgres/mailOAuthService');
// The one-time OAuth app registration (client id/secret/redirect), masked on read.
router.get('/mail-oauth/apps', authenticate, requirePermission('integration', 'read'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await mailOAuthService.getApps() });
}));
router.put('/mail-oauth/apps', authenticate, requirePermission('integration', 'manage'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await mailOAuthService.saveApps(req.body || {}) });
}));
router.get('/mail-oauth/status', authenticate, requirePermission('integration', 'read'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await mailOAuthService.getStatus() });
}));
// Returns the provider consent URL for the SPA to send the browser to. The signed
// state is also stashed in an HttpOnly cookie so the callback can prove it began
// in this browser (CSRF protection), mirroring the SSO flow.
const MAILOAUTH_COOKIE = 'itacm_mailoauth';
function moIsSecure(req) {
  return req.secure || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}
function moReadCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > -1 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}
router.get('/mail-oauth/start', authenticate, requirePermission('integration', 'manage'), asyncHandler(async (req, res) => {
  const data = await mailOAuthService.startConnect(String(req.query.provider || ''));
  res.cookie(MAILOAUTH_COOKIE, data.state, {
    httpOnly: true, secure: moIsSecure(req), sameSite: 'lax',
    maxAge: 10 * 60 * 1000, path: '/api/integrations/mail-oauth',
  });
  res.json({ success: true, data: { url: data.url } });
}));
router.post('/mail-oauth/disconnect', authenticate, requirePermission('integration', 'manage'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await mailOAuthService.disconnect() });
}));
// Public: the provider redirects the BROWSER here, so no Bearer token is possible.
// Safety rests on the signed state (verified in handleCallback), not on a session.
router.get('/mail-oauth/callback', asyncHandler(async (req, res) => {
  const cookieState = moReadCookie(req, MAILOAUTH_COOKIE);
  res.clearCookie(MAILOAUTH_COOKIE, { path: '/api/integrations/mail-oauth' });
  let ok = false; let email = ''; let provider = ''; let message = '';
  try {
    const r = await mailOAuthService.handleCallback({ code: req.query.code, state: req.query.state, cookieState });
    ok = true; email = r.email || ''; provider = r.provider || '';
  } catch (err) { message = err.message || 'Connection failed'; }
  // The instance language, not the browser's: this page belongs to the app, and
  // the operator who started the flow is looking at the app in that language.
  let lang = 'en';
  try { lang = (await settingsService.getSettings()).language || 'en'; } catch { /* default */ }
  const { renderMailOAuthPage } = require('../utils/mailOAuthPage');
  res.status(ok ? 200 : 400).type('html').send(
    renderMailOAuthPage({ ok, email, provider, message, lang })
  );
}));

router.post('/notifications/digest', authenticate, requirePermission('integration', 'read'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await notificationService.runAlertDigest() });
}));

/** Manual "check for updates now" — explicit action, ignores the daily throttle. */
router.post('/update-check', authenticate, requirePermission('integration', 'manage'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await require('../utils/updateCheck').checkNow() });
}));

router.delete('/notifications', authenticate, requirePermission('integration', 'manage'), asyncHandler(async (req, res) => {
  const smtp = req.query.smtp !== '0' && req.body?.smtp !== false;
  const notify = req.query.notify !== '0' && req.body?.notify !== false;
  res.json({ success: true, data: publicMailConfig(await notificationService.clearMailConfig({ smtp, notify })) });
}));

/** ---------- Email templates (integration:read / integration:manage) ---------- */
router.get('/email-templates', authenticate, requirePermission('integration', 'read'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await notificationService.getEmailTemplates() });
}));

router.put('/email-templates', authenticate, requirePermission('integration', 'manage'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await notificationService.saveEmailTemplates(req.body || {}) });
}));

/** ---------- Webhooks (integration:read / integration:manage) ---------- */
router.get('/webhooks', authenticate, requirePermission('integration', 'read'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await webhookService.listWebhooks() });
}));

router.put('/webhooks', authenticate, requirePermission('integration', 'manage'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await webhookService.saveWebhooks(req.body?.webhooks || req.body) });
}));

/** ---------- API keys (integration:read / integration:manage) ---------- */
router.get('/api-keys', authenticate, requirePermission('integration', 'read'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await apiKeyService.listKeys() });
}));

router.post('/api-keys', authenticate, requirePermission('integration', 'manage'), asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, data: await apiKeyService.createKey(req.body || {}, req.user) });
}));

router.delete('/api-keys/:id', authenticate, requirePermission('integration', 'manage'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await apiKeyService.revokeKey(req.params.id, req.user) });
}));

/** ---------- Custom fields (integration:read / integration:manage) ---------- */
router.get('/custom-fields/:entity', authenticate, requirePermission('integration', 'read'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await customFieldService.listDefs(req.params.entity) });
}));

router.post('/custom-fields', authenticate, requirePermission('integration', 'manage'), asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, data: await customFieldService.upsertDef(req.body || {}) });
}));

router.delete('/custom-fields/:entity/:fieldKey', authenticate, requirePermission('integration', 'manage'), asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: await customFieldService.deleteDef(req.params.entity, req.params.fieldKey),
  });
}));

router.get('/custom-fields/:entity/:entityId/values', authenticate, asyncHandler(async (req, res) => {
  await assertEntityAccess(req.params.entity, req.params.entityId, req.user);
  res.json({
    success: true,
    data: await customFieldService.getValues(req.params.entity, req.params.entityId),
  });
}));

router.put('/custom-fields/:entity/:entityId/values', authenticate, requirePermission('integration', 'update'), asyncHandler(async (req, res) => {
  await assertEntityAccess(req.params.entity, req.params.entityId, req.user);
  res.json({
    success: true,
    data: await customFieldService.setValues(req.params.entity, req.params.entityId, req.body || {}),
  });
}));

/** ---------- Sync connectors (integration:manage) ---------- */
router.post(
  '/sync/employees',
  authenticate,
  requirePermission('integration', 'manage'),
  requireScope('sync:employees'),
  express.json({ limit: '6mb' }),
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: await syncService.syncEmployees(req.body?.items || []) });
  })
);

router.post(
  '/sync/assets',
  authenticate,
  requirePermission('integration', 'manage'),
  requireScope('sync:assets'),
  express.json({ limit: '6mb' }),
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: await syncService.syncAssets(req.body?.items || [], req.user) });
  })
);

router.post(
  '/sync/software-installs',
  authenticate,
  requirePermission('integration', 'manage'),
  requireScope('sync:software'),
  express.json({ limit: '6mb' }),
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: await syncService.syncSoftwareInstalls(req.body?.items || []) });
  })
);

router.get('/licenses/:id/sam', authenticate, requirePermission('license', 'read'), requireScope('read'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await syncService.licenseSamReport(req.params.id) });
}));

module.exports = router;
