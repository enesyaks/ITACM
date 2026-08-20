/**
 * Knowledge base (staff). Reading needs ticket:read, authoring ticket:manage;
 * the service-desk module must be on. Employees read published articles via
 * /api/me/kb.
 */
const router = require('express').Router();
const { authenticate, requirePermission } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const { kbService, settingsService } = require('../services');
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
