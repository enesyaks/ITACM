const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const { providerService, documentService } = require('../services');
const { validateUpload } = require('../utils/uploadGuard');
const { contentDisposition } = require('../utils/contentDisposition');

router.use(authenticate);

const write = requireRole('Owner', 'Admin', 'Helpdesk');

/** GET /api/contracts/documents/:docId/download */
router.get('/documents/:docId/download', write, asyncHandler(async (req, res) => {
  const doc = await documentService.getContractDoc(req.params.docId);
  await providerService.getContract(doc.contractId, { role: req.user.role });
  const inline = String(req.query.view || '') === '1' || String(req.query.inline || '') === '1';
  res.setHeader('Content-Type', doc.mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', contentDisposition(doc.filename, { inline }));
  res.send(doc.buffer);
}));

/** DELETE /api/contracts/documents/:docId — Owner/Admin. */
router.delete('/documents/:docId', requireRole('Owner', 'Admin'), asyncHandler(async (req, res) => {
  const doc = await documentService.getContractDoc(req.params.docId);
  await providerService.getContract(doc.contractId, { role: req.user.role });
  res.json({ success: true, data: await documentService.deleteContractDoc(req.params.docId) });
}));

/** GET /api/contracts */
router.get('/', asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: await providerService.listContracts({ ...req.query, role: req.user.role }),
  });
}));

/** POST /api/contracts */
router.post('/', write, asyncHandler(async (req, res) => {
  res.status(201).json({
    success: true,
    data: await providerService.createContract(req.body, { role: req.user.role }),
  });
}));

/** GET /api/contracts/:id/documents */
router.get('/:id/documents', asyncHandler(async (req, res) => {
  await providerService.getContract(req.params.id, { role: req.user.role });
  res.json({ success: true, data: await documentService.listContractDocs(req.params.id) });
}));

/** POST /api/contracts/:id/documents — body: { filename, base64 } */
router.post('/:id/documents', write, express.json({ limit: '12mb' }), asyncHandler(async (req, res) => {
  const { buffer, mime, filename } = validateUpload(req.body || {});
  const contract = await providerService.getContract(req.params.id, { role: req.user.role });
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

/** GET /api/contracts/:id */
router.get('/:id', asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: await providerService.getContract(req.params.id, { role: req.user.role }),
  });
}));

/** PATCH /api/contracts/:id */
router.patch('/:id', write, asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: await providerService.updateContract(req.params.id, req.body, { role: req.user.role }),
  });
}));

/** DELETE /api/contracts/:id */
router.delete('/:id', write, asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: await providerService.deleteContract(req.params.id, { role: req.user.role }),
  });
}));

module.exports = router;
