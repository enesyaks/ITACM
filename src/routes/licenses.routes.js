const express = require('express');
const router = express.Router();
const { authenticate, requireRole, requirePermission, requireAnyPermission } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const { licenseService, documentService } = require('../services');
const { validateUpload } = require('../utils/uploadGuard');
const { contentDisposition } = require('../utils/contentDisposition');
const { redactCosts, redactDocsMeta, gateCostWrite } = require('../utils/financialAccess');

router.use(authenticate);

const privileged = (req) => licenseService.PRIVILEGED_ROLES.has(req.user.role);

/** GET /api/licenses — İzin: license:read */
router.get('/', requirePermission('license', 'read'), asyncHandler(async (req, res) => {
  let data = await licenseService.listLicenses({ ...req.query, privileged: privileged(req) });
  data = await redactCosts(req.user, 'license', data);
  data = await redactDocsMeta(req.user, data);
  res.json({ success: true, data });
}));

/** POST /api/licenses — İzin: license:create */
router.post('/', requirePermission('license', 'create'), asyncHandler(async (req, res) => {
  await gateCostWrite(req.user, 'license', req.body);
  const lic = await licenseService.createLicense(req.body);
  if (!privileged(req)) lic.licenseKey = licenseService.maskLicenseKey(lic.licenseKey, false);
  res.status(201).json({ success: true, data: await redactCosts(req.user, 'license', lic) });
}));

/** GET /api/licenses/documents/:docId/download — İzin: document:download */
router.get('/documents/:docId/download', requirePermission('document', 'download'), asyncHandler(async (req, res) => {
  const doc = await documentService.getLicenseDoc(req.params.docId);
  await licenseService.getLicense(doc.licenseId, { privileged: true });
  const inline = String(req.query.view || '') === '1' || String(req.query.inline || '') === '1';
  res.setHeader('Content-Type', doc.mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', contentDisposition(doc.filename, { inline }));
  res.send(doc.buffer);
}));

/** DELETE /api/licenses/documents/:docId — İzin: document:delete */
router.delete('/documents/:docId', requirePermission('document', 'delete'), asyncHandler(async (req, res) => {
  const doc = await documentService.getLicenseDoc(req.params.docId);
  await licenseService.getLicense(doc.licenseId, { privileged: true });
  res.json({ success: true, data: await documentService.deleteLicenseDoc(req.params.docId) });
}));

/** GET /api/licenses/assignments — İzin: license:read */
router.get('/assignments', requirePermission('license', 'read'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await licenseService.listAssignments(req.query) });
}));

/** POST /api/licenses/assignments/:aid/revoke — İzin: license:assign | unassign | manage */
router.post('/assignments/:aid/revoke',
  requireAnyPermission([['license', 'assign'], ['license', 'unassign'], ['license', 'manage']]),
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: await licenseService.revokeAssignment(req.params.aid, req.user) });
  }));

/** POST /api/licenses/:id/seats — İzin: license:update */
router.post('/:id/seats', requirePermission('license', 'update'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await licenseService.adjustSeats(req.params.id, req.body.delta) });
}));

/** POST /api/licenses/:id/assign — İzin: license:assign | manage */
router.post('/:id/assign',
  requireAnyPermission([['license', 'assign'], ['license', 'manage']]),
  asyncHandler(async (req, res) => {
    res.status(201).json({
      success: true,
      data: await licenseService.assignLicense(req.params.id, req.body.employeeId, req.user),
    });
  }));

/** GET /api/licenses/:id/assignments — İzin: license:read */
router.get('/:id/assignments', requirePermission('license', 'read'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await licenseService.listAssignments({ ...req.query, licenseId: req.params.id }) });
}));

/** GET /api/licenses/:id/assets — İzin: license:read */
router.get('/:id/assets', requirePermission('license', 'read'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await licenseService.listLinkedAssets(req.params.id) });
}));

/** GET /api/licenses/:id/documents — İzin: document:read */
router.get('/:id/documents', requirePermission('document', 'read'), asyncHandler(async (req, res) => {
  await licenseService.getLicense(req.params.id, { privileged: true });
  res.json({ success: true, data: await documentService.listLicenseDocs(req.params.id) });
}));

/** POST /api/licenses/:id/documents — İzin: document:create */
router.post('/:id/documents', requireAnyPermission([['document', 'upload'], ['document', 'create']]), express.json({ limit: '12mb' }), asyncHandler(async (req, res) => {
  const { buffer, mime, filename } = validateUpload(req.body || {});
  const lic = await licenseService.getLicense(req.params.id, { privileged: true });
  const saved = await documentService.saveLicenseDoc({
    licenseId: lic.id,
    providerId: lic.providerId || null,
    kind: req.body.kind || (lic.purchaseType === 'contract' ? 'contract' : 'invoice'),
    filename,
    mime,
    buffer,
    uploadedBy: req.user.uid,
    uploadedByName: req.user.username || req.user.email,
  });
  res.status(201).json({ success: true, data: saved });
}));

/** POST /api/licenses/:id/renew — İzin: license:update */
router.post('/:id/renew', requirePermission('license', 'update'), asyncHandler(async (req, res) => {
  const lic = await licenseService.renewLicense(req.params.id, req.body || {}, req.user);
  if (!privileged(req)) lic.licenseKey = licenseService.maskLicenseKey(lic.licenseKey, false);
  res.json({ success: true, data: lic });
}));

/** POST /api/licenses/:id/cancel — İzin: license:update */
router.post('/:id/cancel', requirePermission('license', 'update'), asyncHandler(async (req, res) => {
  const lic = await licenseService.cancelLicense(req.params.id, req.body || {}, req.user);
  if (!privileged(req)) lic.licenseKey = licenseService.maskLicenseKey(lic.licenseKey, false);
  res.json({ success: true, data: lic });
}));

/** PATCH /api/licenses/:id — İzin: license:update */
router.patch('/:id', requirePermission('license', 'update'), asyncHandler(async (req, res) => {
  await gateCostWrite(req.user, 'license', req.body || {});
  const lic = await licenseService.updateLicense(req.params.id, req.body || {});
  if (!privileged(req)) lic.licenseKey = licenseService.maskLicenseKey(lic.licenseKey, false);
  res.json({ success: true, data: await redactCosts(req.user, 'license', lic) });
}));

/** GET /api/licenses/:id — İzin: license:read */
router.get('/:id', requirePermission('license', 'read'), asyncHandler(async (req, res) => {
  let lic = await licenseService.getLicense(req.params.id, { privileged: privileged(req) });
  lic = await redactCosts(req.user, 'license', lic);
  lic = await redactDocsMeta(req.user, lic);
  res.json({ success: true, data: lic });
}));

module.exports = router;
