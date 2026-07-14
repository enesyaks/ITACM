const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const { providerService, documentService } = require('../services');
const { validateUpload } = require('../utils/uploadGuard');
const { contentDisposition } = require('../utils/contentDisposition');

router.use(authenticate);

const write = requireRole('Owner', 'Admin', 'Helpdesk');

/** GET /api/providers/summary — KPI counts. */
router.get('/summary', asyncHandler(async (req, res) => {
  res.json({ success: true, data: await providerService.summary({ role: req.user.role }) });
}));

/** GET /api/providers/documents/:docId/download — stream a provider document. */
router.get('/documents/:docId/download', write, asyncHandler(async (req, res) => {
  const doc = await documentService.getProviderDoc(req.params.docId);
  // Ensure caller can see this provider (role / soft-delete checks).
  await providerService.getProvider(doc.providerId, { role: req.user.role });
  const inline = String(req.query.view || '') === '1' || String(req.query.inline || '') === '1';
  res.setHeader('Content-Type', doc.mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', contentDisposition(doc.filename, { inline }));
  res.send(doc.buffer);
}));

/** DELETE /api/providers/documents/:docId — Owner/Admin. */
router.delete('/documents/:docId', requireRole('Owner', 'Admin'), asyncHandler(async (req, res) => {
  const doc = await documentService.getProviderDoc(req.params.docId);
  await providerService.getProvider(doc.providerId, { role: req.user.role });
  res.json({ success: true, data: await documentService.deleteProviderDoc(req.params.docId) });
}));

/** GET /api/providers — list vendors / ISPs / MSPs. */
router.get('/', asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: await providerService.listProviders({ ...req.query, role: req.user.role }),
  });
}));

/** POST /api/providers */
router.post('/', write, asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, data: await providerService.createProvider(req.body) });
}));

/** GET /api/providers/:id/documents */
router.get('/:id/documents', asyncHandler(async (req, res) => {
  res.json({ success: true, data: await documentService.listProviderDocs(req.params.id) });
}));

/** POST /api/providers/:id/documents — body: { filename, base64 } */
router.post('/:id/documents', write, express.json({ limit: '12mb' }), asyncHandler(async (req, res) => {
  const { buffer, mime, filename } = validateUpload(req.body || {});
  const provider = await providerService.getProvider(req.params.id, { role: req.user.role });
  const saved = await documentService.saveProviderDoc({
    providerId: provider.id,
    providerName: provider.name,
    filename,
    mime,
    buffer,
    uploadedBy: req.user.uid,
    uploadedByName: req.user.username || req.user.email,
  });
  res.status(201).json({ success: true, data: saved });
}));

/** GET /api/providers/:id */
router.get('/:id', asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: await providerService.getProvider(req.params.id, { role: req.user.role }),
  });
}));

/** PATCH /api/providers/:id */
router.patch('/:id', write, asyncHandler(async (req, res) => {
  res.json({ success: true, data: await providerService.updateProvider(req.params.id, req.body) });
}));

/** DELETE /api/providers/:id */
router.delete('/:id', write, asyncHandler(async (req, res) => {
  res.json({ success: true, data: await providerService.deleteProvider(req.params.id) });
}));

module.exports = router;
