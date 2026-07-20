const router = require('express').Router();
const { authenticate, requirePermission, requireAnyPermission } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const { contentDisposition } = require('../utils/contentDisposition');
const { documentService } = require('../services');

router.use(authenticate);

/** GET /api/documents/:id/download — stream a zimmet / handover archive file.
 * İzin: handover_document:download (this route only serves handover_documents).
 */
router.get('/:id/download',
  requirePermission('handover_document', 'download'),
  asyncHandler(async (req, res) => {
  const doc = await documentService.getDocument(req.params.id);
  const inline = String(req.query.view || '') === '1' || String(req.query.inline || '') === '1';
  res.setHeader('Content-Type', doc.mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', contentDisposition(doc.filename, { inline }));
  res.send(doc.buffer);
}));

/** DELETE /api/documents/:id — remove a zimmet / handover archive file.
 * İzin: handover_document:delete
 */
router.delete('/:id', requirePermission('handover_document', 'delete'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await documentService.deleteDocument(req.params.id) });
}));

module.exports = router;
