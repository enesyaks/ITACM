/**
 * Knowledge base (staff). Reading needs ticket:read, authoring ticket:manage;
 * the service-desk module must be on. Employees read published articles via
 * /api/me/kb.
 */
const express = require('express');
const router = express.Router();
const { authenticate, requirePermission, requireAnyPermission } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const { kbService, settingsService, documentService } = require('../services');
const { validateUpload } = require('../utils/uploadGuard');
const { contentDisposition } = require('../utils/contentDisposition');
const { HttpError } = require('../utils/httpError');

const requireTicketing = asyncHandler(async (req, res, next) => {
  const s = await settingsService.getSettings();
  if (!s.ticketingEnabled) throw HttpError.notFound('The service desk module is not enabled');
  next();
});

router.use(authenticate, requireTicketing);

router.get('/', requirePermission('ticket', 'read'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await kbService.listArticles({ search: req.query.search, category: req.query.category }) });
}));
// Attachments (before /:id). Images render inline; PDFs as links.
router.get('/documents/:docId/download', requirePermission('ticket', 'read'), asyncHandler(async (req, res) => {
  const doc = await documentService.getKbDoc(req.params.docId);
  res.setHeader('Content-Type', doc.mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', contentDisposition(doc.filename, { inline: true }));
  res.send(doc.buffer);
}));
router.delete('/documents/:docId', requirePermission('ticket', 'manage'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await documentService.deleteKbDoc(req.params.docId) });
}));
router.get('/:id/documents', requirePermission('ticket', 'read'), asyncHandler(async (req, res) => {
  await kbService.getArticle(req.params.id);
  res.json({ success: true, data: await documentService.listKbDocs(req.params.id) });
}));
router.post('/:id/documents', requireAnyPermission([['ticket', 'manage']]), express.json({ limit: '12mb' }), asyncHandler(async (req, res) => {
  const article = await kbService.getArticle(req.params.id);
  const { buffer, mime, filename } = validateUpload(req.body || {});
  const saved = await documentService.saveKbDoc({ articleId: article.id, filename, mime, buffer, uploadedBy: req.user.uid, uploadedByName: req.user.username || req.user.email });
  res.status(201).json({ success: true, data: saved });
}));

router.get('/:id', requirePermission('ticket', 'read'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await kbService.getArticle(req.params.id) });
}));
router.post('/', requirePermission('ticket', 'manage'), asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, data: await kbService.createArticle(req.body || {}, req.user.username || req.user.email) });
}));
router.patch('/:id', requirePermission('ticket', 'manage'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await kbService.updateArticle(req.params.id, req.body || {}) });
}));
router.delete('/:id', requirePermission('ticket', 'manage'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await kbService.deleteArticle(req.params.id) });
}));

module.exports = router;
