const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const { maintenanceService, documentService } = require('../services');
const { validateUpload } = require('../utils/uploadGuard');
const { contentDisposition } = require('../utils/contentDisposition');

router.use(authenticate, requireRole('Owner', 'Admin', 'Helpdesk'));

/* ---- Repair paperwork (invoices, service reports, photos) — kept per asset so
   it stays reachable from the device after the repair closes. Defined before the
   generic /:id routes so the literal paths win. ---- */

/** GET /api/maintenance/asset/:assetId/documents — all repair docs for a device. */
router.get('/asset/:assetId/documents', asyncHandler(async (req, res) => {
  res.json({ success: true, data: await documentService.listMaintenanceDocsByAsset(req.params.assetId) });
}));

/** GET /api/maintenance/documents/:docId/download — stream a repair document. */
router.get('/documents/:docId/download', asyncHandler(async (req, res) => {
  const doc = await documentService.getMaintenanceDoc(req.params.docId);
  const inline = String(req.query.view || '') === '1' || String(req.query.inline || '') === '1';
  res.setHeader('Content-Type', doc.mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', contentDisposition(doc.filename, { inline }));
  res.send(doc.buffer);
}));

/** DELETE /api/maintenance/documents/:docId — remove a repair document (Owner/Admin). */
router.delete('/documents/:docId', requireRole('Owner', 'Admin'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await documentService.deleteMaintenanceDoc(req.params.docId) });
}));

/** GET /api/maintenance/:id/documents — repair docs attached to one log. */
router.get('/:id/documents', asyncHandler(async (req, res) => {
  res.json({ success: true, data: await documentService.listMaintenanceDocsByLog(req.params.id) });
}));

/** POST /api/maintenance/:id/documents — upload a repair document. Body: { filename, base64 }. */
router.post('/:id/documents', express.json({ limit: '12mb' }), asyncHandler(async (req, res) => {
  // Type detected from the bytes; filename sanitised; client MIME ignored.
  const { buffer, mime, filename } = validateUpload(req.body || {});
  const log = await maintenanceService.getLog(req.params.id);
  const saved = await documentService.saveMaintenanceDoc({
    maintenanceId: log.id, assetId: log.assetId, assetTag: log.assetTag,
    filename, mime, buffer,
    uploadedBy: req.user.uid, uploadedByName: req.user.username || req.user.email,
  });
  res.status(201).json({ success: true, data: saved });
}));

/** GET /api/maintenance — repair logs; ?open=true for in-flight repairs, ?assetId= per asset. */
router.get('/', asyncHandler(async (req, res) => {
  res.json({ success: true, data: await maintenanceService.listMaintenanceLogs(req.query) });
}));

/** POST /api/maintenance — send an asset to repair (creates log, flips status, audits). */
router.post('/', asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, data: await maintenanceService.sendToRepair(req.body, req.user) });
}));

/** PUT /api/maintenance/:id/close — asset returned from service; body: { cost?, resolutionNote?, scrap? } */
router.put('/:id/close', asyncHandler(async (req, res) => {
  res.json({ success: true, data: await maintenanceService.closeRepair(req.params.id, req.body, req.user) });
}));

/** POST /api/maintenance/:id/note — add a repair progress note (goes to device history too). */
router.post('/:id/note', asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, data: await maintenanceService.addRepairNote(req.params.id, req.body, req.user) });
}));

module.exports = router;
