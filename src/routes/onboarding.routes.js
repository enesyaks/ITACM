const router = require('express').Router();
const { authenticate, requireRole, requirePermission } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const { onboardingService, notificationService } = require('../services');

router.use(authenticate);

/** GET /api/onboardings?due=1&status=&employeeId=. İzin: onboarding:read */
router.get('/', requirePermission('onboarding', 'read'), asyncHandler(async (req, res) => {
  const due = req.query.due === '1' || req.query.due === 'true';
  const data = await onboardingService.listOnboardings({
    due,
    status: req.query.status,
    employeeId: req.query.employeeId,
    limit: req.query.limit,
  });
  res.json({ success: true, data });
}));

/** GET /api/onboardings/:id. İzin: onboarding:read */
router.get('/:id', requirePermission('onboarding', 'read'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await onboardingService.getOnboarding(req.params.id) });
}));

/** POST /api/onboardings — schedule (create employee optional + reserve items). İzin: onboarding:create */
router.post('/', requirePermission('onboarding', 'create'), asyncHandler(async (req, res) => {
  const data = await onboardingService.createOnboarding(req.body, req.user);
  res.status(201).json({ success: true, data });
}));

/** POST /api/onboardings/:id/items. İzin: onboarding:update */
router.post('/:id/items', requirePermission('onboarding', 'update'), asyncHandler(async (req, res) => {
  const data = await onboardingService.addItems(req.params.id, req.body, req.user);
  res.json({ success: true, data });
}));

/** DELETE /api/onboardings/:id/items/:itemId. İzin: onboarding:update */
router.delete('/:id/items/:itemId', requirePermission('onboarding', 'update'), asyncHandler(async (req, res) => {
  const data = await onboardingService.removeItem(req.params.id, req.params.itemId, req.user);
  res.json({ success: true, data });
}));

/** POST /api/onboardings/:id/complete. İzin: onboarding:update */
router.post('/:id/complete', requirePermission('onboarding', 'update'), asyncHandler(async (req, res) => {
  const data = await onboardingService.completeOnboarding(req.params.id, req.body || {}, req.user);
  res.json({ success: true, data });
}));

/** POST /api/onboardings/:id/send-email. İzin: onboarding:update */
router.post('/:id/send-email', requirePermission('onboarding', 'update'), asyncHandler(async (req, res) => {
  const data = await notificationService.sendOnboardingWelcomeEmail({
    onboardingId: req.params.id,
    to: req.body?.to,
    extraNote: req.body?.extraNote,
  });
  res.json({ success: true, data });
}));

/** POST /api/onboardings/:id/cancel. İzin: onboarding:update */
router.post('/:id/cancel', requirePermission('onboarding', 'update'), asyncHandler(async (req, res) => {
  const data = await onboardingService.cancelOnboarding(req.params.id, req.user);
  res.json({ success: true, data });
}));

module.exports = router;
