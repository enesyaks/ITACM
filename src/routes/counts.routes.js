const router = require('express').Router();
const { authenticate, requireRole, requirePermission } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const { countService } = require('../services');

router.use(authenticate);

/** GET /api/counts — count sessions, newest first. İzin: stock_count:read */
router.get('/', requirePermission('stock_count', 'read'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await countService.listCounts(req.query) });
}));

/** POST /api/counts — open a new stock count. İzin: stock_count:create */
router.post('/', requirePermission('stock_count', 'create'), asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, data: await countService.createCount(req.body || {}, req.user) });
}));

/** GET /api/counts/:id — session detail. İzin: stock_count:read */
router.get('/:id', requirePermission('stock_count', 'read'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await countService.getCount(req.params.id) });
}));

/** POST /api/counts/:id/scan — record one scan. İzin: stock_count:update */
router.post('/:id/scan', requirePermission('stock_count', 'update'), asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, data: await countService.scanTag(req.params.id, (req.body || {}).raw, req.user) });
}));

/** POST /api/counts/:id/close — close & compare against inventory. İzin: stock_count:update */
router.post('/:id/close', requirePermission('stock_count', 'update'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await countService.closeCount(req.params.id, req.user) });
}));

module.exports = router;
