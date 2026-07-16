const express = require('express');
const router = express.Router();
const { authenticate, requirePermission, requireAnyPermission } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const { maintenanceService, documentService } = require('../services');
const { validateUpload } = require('../utils/uploadGuard');
const { contentDisposition } = require('../utils/contentDisposition');
const { redactCosts, gateCostWrite } = require('../utils/financialAccess');

router.use(authenticate);

/* ---- Repair paperwork ---- */

/** GET /api/maintenance/asset/:assetId/documents — İzin: document:read */
router.get('/asset/:assetId/documents', requirePermission('document', 'read'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await documentService.listMaintenanceDocsByAsset(req.params.assetId) });
}));

/** GET /api/maintenance/documents/:docId/download — İzin: document:download */
router.get('/documents/:docId/download', requirePermission('document', 'download'), asyncHandler(async (req, res) => {
  const doc = await documentService.getMaintenanceDoc(req.params.docId);
  const inline = String(req.query.view || '') === '1' || String(req.query.inline || '') === '1';
  res.setHeader('Content-Type', doc.mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', contentDisposition(doc.filename, { inline }));
  res.send(doc.buffer);
}));

/** DELETE /api/maintenance/documents/:docId — İzin: document:delete */
router.delete('/documents/:docId', requirePermission('document', 'delete'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await documentService.deleteMaintenanceDoc(req.params.docId) });
}));

/** GET /api/maintenance/:id/documents — İzin: document:read */
router.get('/:id/documents', requirePermission('document', 'read'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await documentService.listMaintenanceDocsByLog(req.params.id) });
}));

/** POST /api/maintenance/:id/documents — İzin: document:create */
router.post('/:id/documents', requireAnyPermission([['document', 'upload'], ['document', 'create']]), express.json({ limit: '12mb' }), asyncHandler(async (req, res) => {
  const { buffer, mime, filename } = validateUpload(req.body || {});
  const log = await maintenanceService.getLog(req.params.id);
  const saved = await documentService.saveMaintenanceDoc({
    maintenanceId: log.id, assetId: log.assetId, assetTag: log.assetTag,
    filename, mime, buffer,
    uploadedBy: req.user.uid, uploadedByName: req.user.username || req.user.email,
  });
  res.status(201).json({ success: true, data: saved });
}));

/** GET /api/maintenance — repair logs. İzin: maintenance:read */
router.get('/', requirePermission('maintenance', 'read'), asyncHandler(async (req, res) => {
  const data = await maintenanceService.listMaintenanceLogs(req.query);
  res.json({ success: true, data: await redactCosts(req.user, 'maintenance', data) });
}));

/** POST /api/maintenance — send an asset to repair. İzin: maintenance:create */
router.post('/', requirePermission('maintenance', 'create'), asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, data: await maintenanceService.sendToRepair(req.body, req.user) });
}));

/** PUT /api/maintenance/:id/close — asset returned from service. İzin: maintenance:update */
router.put('/:id/close', requirePermission('maintenance', 'update'), asyncHandler(async (req, res) => {
  await gateCostWrite(req.user, 'maintenance', req.body || {});
  res.json({ success: true, data: await maintenanceService.closeRepair(req.params.id, req.body, req.user) });
}));

/** POST /api/maintenance/:id/note — add a repair progress note. İzin: maintenance:update */
router.post('/:id/note', requirePermission('maintenance', 'update'), asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, data: await maintenanceService.addRepairNote(req.params.id, req.body, req.user) });
}));

module.exports = router;
