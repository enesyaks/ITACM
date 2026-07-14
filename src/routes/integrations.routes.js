const express = require('express');
const router = express.Router();
const { authenticate, requireRole, requireScope } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const {
  notificationService, webhookService, customFieldService,
  apiKeyService, syncService, providerService,
} = require('../services');

const ownerAdmin = requireRole('Owner', 'Admin');
const writeStaff = requireRole('Owner', 'Admin', 'Helpdesk');

async function assertEntityAccess(entity, entityId, role) {
  if (entity === 'contract') {
    await providerService.getContract(entityId, { role });
  }
}

/** ---------- Mail / digest ---------- */
router.get('/notifications', authenticate, ownerAdmin, asyncHandler(async (req, res) => {
  const cfg = await notificationService.getMailConfig();
  if (cfg.smtp) cfg.smtp = { ...cfg.smtp, pass: cfg.smtp.pass ? '••••••••' : '' };
  res.json({ success: true, data: cfg });
}));

router.put('/notifications', authenticate, requireRole('Owner'), asyncHandler(async (req, res) => {
  const body = req.body || {};
  // Password keep/replace is handled in saveMailConfig (empty + mask → keep).
  const cfg = await notificationService.saveMailConfig(body);
  if (cfg.smtp) cfg.smtp = { ...cfg.smtp, pass: cfg.smtp.pass ? '••••••••' : '' };
  res.json({ success: true, data: cfg });
}));

router.post('/notifications/test', authenticate, requireRole('Owner'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await notificationService.sendTestEmail(req.body?.to) });
}));

router.post('/notifications/digest', authenticate, ownerAdmin, asyncHandler(async (req, res) => {
  res.json({ success: true, data: await notificationService.runAlertDigest() });
}));

router.delete('/notifications', authenticate, requireRole('Owner'), asyncHandler(async (req, res) => {
  const smtp = req.query.smtp !== '0' && req.body?.smtp !== false;
  const notify = req.query.notify !== '0' && req.body?.notify !== false;
  const cfg = await notificationService.clearMailConfig({ smtp, notify });
  if (cfg.smtp) cfg.smtp = { ...cfg.smtp, pass: cfg.smtp.pass ? '••••••••' : '' };
  res.json({ success: true, data: cfg });
}));

/** ---------- Webhooks ---------- */
router.get('/webhooks', authenticate, ownerAdmin, asyncHandler(async (req, res) => {
  res.json({ success: true, data: await webhookService.listWebhooks() });
}));

router.put('/webhooks', authenticate, requireRole('Owner'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await webhookService.saveWebhooks(req.body?.webhooks || req.body) });
}));

/** ---------- API keys ---------- */
router.get('/api-keys', authenticate, ownerAdmin, asyncHandler(async (req, res) => {
  res.json({ success: true, data: await apiKeyService.listKeys() });
}));

router.post('/api-keys', authenticate, requireRole('Owner'), asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, data: await apiKeyService.createKey(req.body || {}, req.user) });
}));

router.delete('/api-keys/:id', authenticate, requireRole('Owner'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await apiKeyService.revokeKey(req.params.id, req.user) });
}));

/** ---------- Custom fields ---------- */
router.get('/custom-fields/:entity', authenticate, asyncHandler(async (req, res) => {
  res.json({ success: true, data: await customFieldService.listDefs(req.params.entity) });
}));

router.post('/custom-fields', authenticate, ownerAdmin, asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, data: await customFieldService.upsertDef(req.body || {}) });
}));

router.delete('/custom-fields/:entity/:fieldKey', authenticate, ownerAdmin, asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: await customFieldService.deleteDef(req.params.entity, req.params.fieldKey),
  });
}));

router.get('/custom-fields/:entity/:entityId/values', authenticate, asyncHandler(async (req, res) => {
  await assertEntityAccess(req.params.entity, req.params.entityId, req.user.role);
  res.json({
    success: true,
    data: await customFieldService.getValues(req.params.entity, req.params.entityId),
  });
}));

router.put('/custom-fields/:entity/:entityId/values', authenticate, writeStaff, asyncHandler(async (req, res) => {
  await assertEntityAccess(req.params.entity, req.params.entityId, req.user.role);
  res.json({
    success: true,
    data: await customFieldService.setValues(req.params.entity, req.params.entityId, req.body || {}),
  });
}));

/** ---------- Sync connectors ---------- */
router.post(
  '/sync/employees',
  authenticate,
  writeStaff,
  requireScope('sync:employees'),
  express.json({ limit: '6mb' }),
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: await syncService.syncEmployees(req.body?.items || []) });
  })
);

router.post(
  '/sync/assets',
  authenticate,
  writeStaff,
  requireScope('sync:assets'),
  express.json({ limit: '6mb' }),
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: await syncService.syncAssets(req.body?.items || [], req.user) });
  })
);

router.post(
  '/sync/software-installs',
  authenticate,
  writeStaff,
  requireScope('sync:software'),
  express.json({ limit: '6mb' }),
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: await syncService.syncSoftwareInstalls(req.body?.items || []) });
  })
);

router.get('/licenses/:id/sam', authenticate, requireScope('read'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await syncService.licenseSamReport(req.params.id) });
}));

module.exports = router;
