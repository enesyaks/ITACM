const router = require('express').Router();
const { authenticate, requireRole } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const { countService } = require('../services');

router.use(authenticate);

/** GET /api/counts — count sessions, newest first (all roles). */
router.get('/', asyncHandler(async (req, res) => {
  res.json({ success: true, data: await countService.listCounts(req.query) });
}));

/** POST /api/counts — open a new stock count; body: { name?, location? } (Admin/Helpdesk). */
router.post('/', requireRole('Owner', 'Admin', 'Helpdesk'), asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, data: await countService.createCount(req.body || {}, req.user) });
}));

/** GET /api/counts/:id — session detail: scans + live progress (all roles). */
router.get('/:id', asyncHandler(async (req, res) => {
  res.json({ success: true, data: await countService.getCount(req.params.id) });
}));

/** POST /api/counts/:id/scan — record one scan; body: { raw } (Admin/Helpdesk). */
router.post('/:id/scan', requireRole('Owner', 'Admin', 'Helpdesk'), asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, data: await countService.scanTag(req.params.id, (req.body || {}).raw, req.user) });
}));

/** POST /api/counts/:id/close — close & compare against inventory (Admin/Helpdesk). */
router.post('/:id/close', requireRole('Owner', 'Admin', 'Helpdesk'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await countService.closeCount(req.params.id, req.user) });
}));

module.exports = router;
