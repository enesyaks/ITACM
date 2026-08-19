/**
 * ITIL Problem Management — staff endpoints. Requires the `problem` permission
 * AND the ticketing module (problems live alongside the service desk).
 */
const router = require('express').Router();
const { authenticate, requirePermission } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const { problemService, settingsService } = require('../services');
const { HttpError } = require('../utils/httpError');

const requireTicketing = asyncHandler(async (req, res, next) => {
  const s = await settingsService.getSettings();
  if (!s.ticketingEnabled) throw HttpError.notFound('The service desk module is not enabled');
  next();
});

router.use(authenticate, requireTicketing);

router.get('/', requirePermission('problem', 'read'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await problemService.listProblems({
    status: req.query.status,
    open: req.query.open === '1' || req.query.open === 'true',
    limit: req.query.limit,
  }) });
}));

router.post('/', requirePermission('problem', 'create'), asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, data: await problemService.createProblem(req.body || {}, req.user) });
}));

router.get('/:id', requirePermission('problem', 'read'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await problemService.getProblem(req.params.id) });
}));

router.patch('/:id', requirePermission('problem', 'update'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await problemService.updateProblem(req.params.id, req.body || {}, req.user) });
}));

// Link / unlink an incident to this problem.
router.post('/:id/link', requirePermission('problem', 'update'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await problemService.linkTicket(req.params.id, req.body && req.body.ticketId) });
}));
router.delete('/:id/link/:ticketId', requirePermission('problem', 'update'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await problemService.unlinkTicket(req.params.id, req.params.ticketId) });
}));

module.exports = router;
