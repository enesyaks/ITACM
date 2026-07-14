const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const { licenseService, documentService } = require('../services');
const { validateUpload } = require('../utils/uploadGuard');
const { contentDisposition } = require('../utils/contentDisposition');

router.use(authenticate);

const write = requireRole('Owner', 'Admin', 'Helpdesk');
const privileged = (req) => licenseService.PRIVILEGED_ROLES.has(req.user.role);

/** GET /api/licenses */
router.get('/', asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: await licenseService.listLicenses({ ...req.query, privileged: privileged(req) }),
  });
}));

/** POST /api/licenses */
router.post('/', write, asyncHandler(async (req, res) => {
  const lic = await licenseService.createLicense(req.body);
  if (!privileged(req)) lic.licenseKey = licenseService.maskLicenseKey(lic.licenseKey, false);
  res.status(201).json({ success: true, data: lic });
}));

/** GET /api/licenses/documents/:docId/download */
router.get('/documents/:docId/download', write, asyncHandler(async (req, res) => {
  const doc = await documentService.getLicenseDoc(req.params.docId);
  await licenseService.getLicense(doc.licenseId, { privileged: true });
  const inline = String(req.query.view || '') === '1' || String(req.query.inline || '') === '1';
  res.setHeader('Content-Type', doc.mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', contentDisposition(doc.filename, { inline }));
  res.send(doc.buffer);
}));

/** DELETE /api/licenses/documents/:docId */
router.delete('/documents/:docId', requireRole('Owner', 'Admin'), asyncHandler(async (req, res) => {
  const doc = await documentService.getLicenseDoc(req.params.docId);
  await licenseService.getLicense(doc.licenseId, { privileged: true });
  res.json({ success: true, data: await documentService.deleteLicenseDoc(req.params.docId) });
}));

/** GET /api/licenses/assignments */
router.get('/assignments', asyncHandler(async (req, res) => {
  res.json({ success: true, data: await licenseService.listAssignments(req.query) });
}));

/** POST /api/licenses/assignments/:aid/revoke */
router.post('/assignments/:aid/revoke', write, asyncHandler(async (req, res) => {
  res.json({ success: true, data: await licenseService.revokeAssignment(req.params.aid, req.user) });
}));

/** POST /api/licenses/:id/seats */
router.post('/:id/seats', write, asyncHandler(async (req, res) => {
  res.json({ success: true, data: await licenseService.adjustSeats(req.params.id, req.body.delta) });
}));

/** POST /api/licenses/:id/assign */
router.post('/:id/assign', write, asyncHandler(async (req, res) => {
  res.status(201).json({
    success: true,
    data: await licenseService.assignLicense(req.params.id, req.body.employeeId, req.user),
  });
}));

/** GET /api/licenses/:id/assignments */
router.get('/:id/assignments', asyncHandler(async (req, res) => {
  res.json({ success: true, data: await licenseService.listAssignments({ ...req.query, licenseId: req.params.id }) });
}));

/** GET /api/licenses/:id/assets */
router.get('/:id/assets', asyncHandler(async (req, res) => {
  res.json({ success: true, data: await licenseService.listLinkedAssets(req.params.id) });
}));

/** GET /api/licenses/:id/documents */
router.get('/:id/documents', asyncHandler(async (req, res) => {
  await licenseService.getLicense(req.params.id, { privileged: true });
  res.json({ success: true, data: await documentService.listLicenseDocs(req.params.id) });
}));

/** POST /api/licenses/:id/documents */
router.post('/:id/documents', write, express.json({ limit: '12mb' }), asyncHandler(async (req, res) => {
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

/** POST /api/licenses/:id/renew */
router.post('/:id/renew', write, asyncHandler(async (req, res) => {
  const lic = await licenseService.renewLicense(req.params.id, req.body || {}, req.user);
  if (!privileged(req)) lic.licenseKey = licenseService.maskLicenseKey(lic.licenseKey, false);
  res.json({ success: true, data: lic });
}));

/** POST /api/licenses/:id/cancel */
router.post('/:id/cancel', write, asyncHandler(async (req, res) => {
  const lic = await licenseService.cancelLicense(req.params.id, req.body || {}, req.user);
  if (!privileged(req)) lic.licenseKey = licenseService.maskLicenseKey(lic.licenseKey, false);
  res.json({ success: true, data: lic });
}));

/** PATCH /api/licenses/:id */
router.patch('/:id', write, asyncHandler(async (req, res) => {
  const lic = await licenseService.updateLicense(req.params.id, req.body || {});
  if (!privileged(req)) lic.licenseKey = licenseService.maskLicenseKey(lic.licenseKey, false);
  res.json({ success: true, data: lic });
}));

/** GET /api/licenses/:id */
router.get('/:id', asyncHandler(async (req, res) => {
  const lic = await licenseService.getLicense(req.params.id, { privileged: privileged(req) });
  res.json({ success: true, data: lic });
}));

module.exports = router;
