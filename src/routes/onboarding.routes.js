const router = require('express').Router();
const { authenticate, requireRole } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const { onboardingService } = require('../services');

router.use(authenticate);

const staff = requireRole('Owner', 'Admin', 'Helpdesk');

/** GET /api/onboardings?due=1&status=&employeeId= */
router.get('/', asyncHandler(async (req, res) => {
  const due = req.query.due === '1' || req.query.due === 'true';
  const data = await onboardingService.listOnboardings({
    due,
    status: req.query.status,
    employeeId: req.query.employeeId,
    limit: req.query.limit,
  });
  res.json({ success: true, data });
}));

/** GET /api/onboardings/:id */
router.get('/:id', asyncHandler(async (req, res) => {
  res.json({ success: true, data: await onboardingService.getOnboarding(req.params.id) });
}));

/** POST /api/onboardings — schedule (create employee optional + reserve items) */
router.post('/', staff, asyncHandler(async (req, res) => {
  const data = await onboardingService.createOnboarding(req.body, req.user);
  res.status(201).json({ success: true, data });
}));

/** POST /api/onboardings/:id/items */
router.post('/:id/items', staff, asyncHandler(async (req, res) => {
  const data = await onboardingService.addItems(req.params.id, req.body, req.user);
  res.json({ success: true, data });
}));

/** DELETE /api/onboardings/:id/items/:itemId */
router.delete('/:id/items/:itemId', staff, asyncHandler(async (req, res) => {
  const data = await onboardingService.removeItem(req.params.id, req.params.itemId, req.user);
  res.json({ success: true, data });
}));

/** POST /api/onboardings/:id/complete */
router.post('/:id/complete', staff, asyncHandler(async (req, res) => {
  const data = await onboardingService.completeOnboarding(req.params.id, req.body || {}, req.user);
  res.json({ success: true, data });
}));

/** POST /api/onboardings/:id/cancel */
router.post('/:id/cancel', staff, asyncHandler(async (req, res) => {
  const data = await onboardingService.cancelOnboarding(req.params.id, req.user);
  res.json({ success: true, data });
}));

module.exports = router;
