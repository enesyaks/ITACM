const express = require('express');
const router = express.Router();
const { authenticate, requirePermission, requireAnyPermission } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const { providerService, documentService } = require('../services');
const { validateUpload } = require('../utils/uploadGuard');
const { contentDisposition } = require('../utils/contentDisposition');
const { redactCosts, redactDocsMeta, gateCostWrite } = require('../utils/financialAccess');

router.use(authenticate);

/** GET /api/contracts/documents/:docId/download — İzin: document:download */
router.get('/documents/:docId/download', requirePermission('document', 'download'), asyncHandler(async (req, res) => {
  const doc = await documentService.getContractDoc(req.params.docId);
  await providerService.getContract(doc.contractId, { user: req.user });
  const inline = String(req.query.view || '') === '1' || String(req.query.inline || '') === '1';
  res.setHeader('Content-Type', doc.mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', contentDisposition(doc.filename, { inline }));
  res.send(doc.buffer);
}));

/** DELETE /api/contracts/documents/:docId — İzin: document:delete */
router.delete('/documents/:docId', requirePermission('document', 'delete'), asyncHandler(async (req, res) => {
  const doc = await documentService.getContractDoc(req.params.docId);
  await providerService.getContract(doc.contractId, { user: req.user });
  res.json({ success: true, data: await documentService.deleteContractDoc(req.params.docId) });
}));

/** GET /api/contracts — İzin: contract:read */
router.get('/', requirePermission('contract', 'read'), asyncHandler(async (req, res) => {
  let data = await providerService.listContracts({ ...req.query, user: req.user });
  data = await redactCosts(req.user, 'contract', data);
  data = await redactDocsMeta(req.user, data);
  res.json({ success: true, data });
}));

/** POST /api/contracts — İzin: contract:create */
router.post('/', requirePermission('contract', 'create'), asyncHandler(async (req, res) => {
  await gateCostWrite(req.user, 'contract', req.body);
  res.status(201).json({
    success: true,
    data: await providerService.createContract(req.body, { user: req.user }),
  });
}));

/** GET /api/contracts/:id/documents — İzin: document:read */
router.get('/:id/documents', requirePermission('document', 'read'), asyncHandler(async (req, res) => {
  await providerService.getContract(req.params.id, { user: req.user });
  res.json({ success: true, data: await documentService.listContractDocs(req.params.id) });
}));

/** POST /api/contracts/:id/documents — İzin: document:create */
router.post('/:id/documents', requireAnyPermission([['document', 'upload'], ['document', 'create']]), express.json({ limit: '12mb' }), asyncHandler(async (req, res) => {
  const { buffer, mime, filename } = validateUpload(req.body || {});
  const contract = await providerService.getContract(req.params.id, { user: req.user });
  const saved = await documentService.saveContractDoc({
    contractId: contract.id,
    providerId: contract.providerId,
    contractTitle: contract.title,
    providerName: contract.providerName,
    filename,
    mime,
    buffer,
    uploadedBy: req.user.uid,
    uploadedByName: req.user.username || req.user.email,
  });
  res.status(201).json({ success: true, data: saved });
}));

/** GET /api/contracts/:id — İzin: contract:read */
router.get('/:id', requirePermission('contract', 'read'), asyncHandler(async (req, res) => {
  let data = await providerService.getContract(req.params.id, { user: req.user });
  data = await redactCosts(req.user, 'contract', data);
  data = await redactDocsMeta(req.user, data);
  res.json({ success: true, data });
}));

/** PATCH /api/contracts/:id — İzin: contract:update */
router.patch('/:id', requirePermission('contract', 'update'), asyncHandler(async (req, res) => {
  await gateCostWrite(req.user, 'contract', req.body);
  res.json({
    success: true,
    data: await providerService.updateContract(req.params.id, req.body, { user: req.user }),
  });
}));

/** DELETE /api/contracts/:id — İzin: contract:delete */
router.delete('/:id', requirePermission('contract', 'delete'), asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: await providerService.deleteContract(req.params.id, { user: req.user }),
  });
}));

module.exports = router;
