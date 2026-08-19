/**
 * Service-request templates (admin). CRUD is gated on `ticket:manage`; the
 * module must be on. Employees read the enabled templates via /api/me/request-templates.
 */
const router = require('express').Router();
const { authenticate, requirePermission } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const { requestTemplateService, settingsService } = require('../services');
const { HttpError } = require('../utils/httpError');

const requireTicketing = asyncHandler(async (req, res, next) => {
  const s = await settingsService.getSettings();
  if (!s.ticketingEnabled) throw HttpError.notFound('The service desk module is not enabled');
  next();
});

router.use(authenticate, requireTicketing);

router.get('/', requirePermission('ticket', 'read'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await requestTemplateService.listTemplates() });
}));
router.post('/', requirePermission('ticket', 'manage'), asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, data: await requestTemplateService.createTemplate(req.body || {}) });
}));
router.patch('/:id', requirePermission('ticket', 'manage'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await requestTemplateService.updateTemplate(req.params.id, req.body || {}) });
}));
router.delete('/:id', requirePermission('ticket', 'manage'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await requestTemplateService.deleteTemplate(req.params.id) });
}));

module.exports = router;
