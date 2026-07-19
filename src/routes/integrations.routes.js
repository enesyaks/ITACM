const express = require('express');
const router = express.Router();
const { authenticate, requireRole, requirePermission, requireScope } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const {
  notificationService, webhookService, customFieldService,
  apiKeyService, syncService, providerService, permissionService,
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

router.post('/notifications/digest', authenticate, requirePermission('integration', 'read'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await notificationService.runAlertDigest() });
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
