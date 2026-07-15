const router = require('express').Router();
const { authenticate, requirePermission, requireAnyPermission } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const { lineService } = require('../services');
const { redactCosts, gateCostWrite } = require('../utils/financialAccess');

router.use(authenticate);

/** GET /api/lines — mobile line inventory. İzin: line:read */
router.get('/', requirePermission('line', 'read'), asyncHandler(async (req, res) => {
  const data = await lineService.listLines(req.query);
  res.json({ success: true, data: await redactCosts(req.user, 'line', data) });
}));

/** POST /api/lines — register a line. İzin: line:create */
router.post('/', requirePermission('line', 'create'), asyncHandler(async (req, res) => {
  await gateCostWrite(req.user, 'line', req.body);
  res.status(201).json({ success: true, data: await lineService.createLine(req.body) });
}));

/** PUT /api/lines/:id — edit a line. İzin: line:update */
router.put('/:id', requirePermission('line', 'update'), asyncHandler(async (req, res) => {
  await gateCostWrite(req.user, 'line', req.body);
  res.json({ success: true, data: await lineService.updateLine(req.params.id, req.body) });
}));

/** POST /api/lines/:id/assign — assign to an employee. İzin: line:assign */
router.post('/:id/assign', requirePermission('line', 'assign'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await lineService.assignLine(req.params.id, (req.body || {}).employeeId, req.user) });
}));

/** POST /api/lines/:id/unassign — take the line back. İzin: line:unassign | manage */
router.post('/:id/unassign',
  requireAnyPermission([['line', 'unassign'], ['line', 'manage']]),
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: await lineService.unassignLine(req.params.id, req.user) });
  }));

module.exports = router;
