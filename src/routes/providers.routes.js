const express = require('express');
const router = express.Router();
const { authenticate, requirePermission, requireAnyPermission } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const { providerService, documentService } = require('../services');
const { validateUpload } = require('../utils/uploadGuard');
const { contentDisposition } = require('../utils/contentDisposition');
const { redactDocsMeta } = require('../utils/financialAccess');

router.use(authenticate);

/** GET /api/providers/summary — KPI counts. İzin: provider:read */
router.get('/summary', requirePermission('provider', 'read'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await providerService.summary({ user: req.user }) });
}));

/** GET /api/providers/documents/:docId/download — İzin: document:download */
router.get('/documents/:docId/download', requirePermission('document', 'download'), asyncHandler(async (req, res) => {
  const doc = await documentService.getProviderDoc(req.params.docId);
  await providerService.getProvider(doc.providerId, { user: req.user });
  const inline = String(req.query.view || '') === '1' || String(req.query.inline || '') === '1';
  res.setHeader('Content-Type', doc.mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', contentDisposition(doc.filename, { inline }));
  res.send(doc.buffer);
}));

/** DELETE /api/providers/documents/:docId — İzin: document:delete */
router.delete('/documents/:docId', requirePermission('document', 'delete'), asyncHandler(async (req, res) => {
  const doc = await documentService.getProviderDoc(req.params.docId);
  await providerService.getProvider(doc.providerId, { user: req.user });
  res.json({ success: true, data: await documentService.deleteProviderDoc(req.params.docId) });
}));

/** GET /api/providers — list vendors / ISPs / MSPs. İzin: provider:read */
router.get('/', requirePermission('provider', 'read'), asyncHandler(async (req, res) => {
  const data = await providerService.listProviders({ ...req.query, user: req.user });
  res.json({ success: true, data: await redactDocsMeta(req.user, data) });
}));

/** POST /api/providers — İzin: provider:create */
router.post('/', requirePermission('provider', 'create'), asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, data: await providerService.createProvider(req.body) });
}));

/** GET /api/providers/:id/documents — İzin: document:read */
router.get('/:id/documents', requirePermission('document', 'read'), asyncHandler(async (req, res) => {
  await providerService.getProvider(req.params.id, { user: req.user });
  res.json({ success: true, data: await documentService.listProviderDocs(req.params.id) });
}));

/** POST /api/providers/:id/documents — İzin: document:create */
router.post('/:id/documents', requireAnyPermission([['document', 'upload'], ['document', 'create']]), express.json({ limit: '12mb' }), asyncHandler(async (req, res) => {
  const { buffer, mime, filename } = validateUpload(req.body || {});
  const provider = await providerService.getProvider(req.params.id, { user: req.user });
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

/** GET /api/providers/:id — İzin: provider:read */
router.get('/:id', requirePermission('provider', 'read'), asyncHandler(async (req, res) => {
  const data = await providerService.getProvider(req.params.id, { user: req.user });
  res.json({ success: true, data: await redactDocsMeta(req.user, data) });
}));

/** PATCH /api/providers/:id — İzin: provider:update */
router.patch('/:id', requirePermission('provider', 'update'), asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: await providerService.updateProvider(req.params.id, req.body, { user: req.user }),
  });
}));

/** DELETE /api/providers/:id — İzin: provider:delete */
router.delete('/:id', requirePermission('provider', 'delete'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await providerService.deleteProvider(req.params.id) });
}));

module.exports = router;
