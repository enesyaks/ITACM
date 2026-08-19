/**
 * ITIL Change Enablement — staff endpoints. Requires the `change` permission AND
 * the ticketing module. `approve` is a distinct action from `update` (CAB gate).
 */
const router = require('express').Router();
const { authenticate, requirePermission } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const { changeService, settingsService } = require('../services');
const { HttpError } = require('../utils/httpError');

const requireTicketing = asyncHandler(async (req, res, next) => {
  const s = await settingsService.getSettings();
  if (!s.ticketingEnabled) throw HttpError.notFound('The service desk module is not enabled');
  next();
});

router.use(authenticate, requireTicketing);

router.get('/', requirePermission('change', 'read'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await changeService.listChanges({
    status: req.query.status, type: req.query.type,
    open: req.query.open === '1' || req.query.open === 'true',
    limit: req.query.limit,
  }) });
}));

router.post('/', requirePermission('change', 'create'), asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, data: await changeService.createChange(req.body || {}, req.user) });
}));

router.get('/:id', requirePermission('change', 'read'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await changeService.getChange(req.params.id) });
}));

router.patch('/:id', requirePermission('change', 'update'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await changeService.updateChange(req.params.id, req.body || {}, req.user) });
}));

// CAB decision — separate `change:approve` permission.
router.post('/:id/decision', requirePermission('change', 'approve'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await changeService.decideChange(req.params.id, req.body || {}, req.user) });
}));

module.exports = router;
