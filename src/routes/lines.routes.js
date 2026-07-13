const router = require('express').Router();
const { authenticate, requireRole } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const { lineService } = require('../services');

router.use(authenticate);

/** GET /api/lines — mobile line inventory; ?status=&employeeId=&search= (all roles). */
router.get('/', asyncHandler(async (req, res) => {
  res.json({ success: true, data: await lineService.listLines(req.query) });
}));

/** POST /api/lines — register a line (Admin/Helpdesk). */
router.post('/', requireRole('Owner', 'Admin', 'Helpdesk'), asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, data: await lineService.createLine(req.body) });
}));

/** PUT /api/lines/:id — edit a line (Admin/Helpdesk). */
router.put('/:id', requireRole('Owner', 'Admin', 'Helpdesk'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await lineService.updateLine(req.params.id, req.body) });
}));

/** POST /api/lines/:id/assign — assign to an employee; body: { employeeId } (Admin/Helpdesk). */
router.post('/:id/assign', requireRole('Owner', 'Admin', 'Helpdesk'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await lineService.assignLine(req.params.id, (req.body || {}).employeeId, req.user) });
}));

/** POST /api/lines/:id/unassign — take the line back (Admin/Helpdesk). */
router.post('/:id/unassign', requireRole('Owner', 'Admin', 'Helpdesk'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await lineService.unassignLine(req.params.id, req.user) });
}));

module.exports = router;
