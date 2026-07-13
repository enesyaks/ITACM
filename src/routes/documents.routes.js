const router = require('express').Router();
const { authenticate, requireRole } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const { contentDisposition } = require('../utils/contentDisposition');
const { documentService } = require('../services');

router.use(authenticate, requireRole('Owner', 'Admin', 'Helpdesk'));

/** GET /api/documents/:id/download — stream an archived document. */
router.get('/:id/download', asyncHandler(async (req, res) => {
  const doc = await documentService.getDocument(req.params.id);
  const inline = String(req.query.view || '') === '1' || String(req.query.inline || '') === '1';
  res.setHeader('Content-Type', doc.mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', contentDisposition(doc.filename, { inline }));
  res.send(doc.buffer);
}));

/** DELETE /api/documents/:id — remove an archived document (Owner/Admin). */
router.delete('/:id', requireRole('Owner', 'Admin'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await documentService.deleteDocument(req.params.id) });
}));

module.exports = router;
