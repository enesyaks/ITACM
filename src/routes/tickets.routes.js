/**
 * Service desk (ITIL) — staff endpoints. Every route needs the `ticket`
 * permission AND the optional module to be switched on (else 404, as if absent).
 * Employees raise their own tickets via /api/me/tickets (me.routes.js).
 */
const router = require('express').Router();
const { authenticate, requirePermission } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const { ticketService, settingsService } = require('../services');
const { HttpError } = require('../utils/httpError');

// Gate the whole module: when ticketing is off, behave as if the routes don't exist.
const requireTicketing = asyncHandler(async (req, res, next) => {
  const s = await settingsService.getSettings();
  if (!s.ticketingEnabled) throw HttpError.notFound('The service desk module is not enabled');
  next();
});

router.use(authenticate, requireTicketing);

// GET /api/tickets — list (filters: status, type, assigneeUserId, open, assetId)
router.get('/', requirePermission('ticket', 'read'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await ticketService.listTickets({
    status: req.query.status,
    type: req.query.type,
    priority: req.query.priority,
    category: req.query.category,
    search: req.query.search,
    sort: req.query.sort,
    order: req.query.order,
    assigneeUserId: req.query.assignee,
    assetId: req.query.assetId,
    open: req.query.open === '1' || req.query.open === 'true',
    limit: req.query.limit,
  }) });
}));

// POST /api/tickets — open a ticket
router.post('/', requirePermission('ticket', 'create'), asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, data: await ticketService.createTicket(req.body || {}, req.user) });
}));

// GET /api/tickets/stats — KPI counts for the service-desk strip (before /:id)
router.get('/stats', requirePermission('ticket', 'read'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await ticketService.stats() });
}));

// GET/PUT /api/tickets/sla — effective SLA targets / save overrides (before /:id)
router.get('/sla', requirePermission('ticket', 'read'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await ticketService.getSlaConfig() });
}));
router.put('/sla', requirePermission('ticket', 'manage'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await ticketService.saveSlaConfig(req.body || {}) });
}));

// GET /api/tickets/categories — distinct categories for the filter (before /:id)
router.get('/categories', requirePermission('ticket', 'read'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await ticketService.categories() });
}));

// GET/PUT /api/tickets/canned — quick-reply templates (before /:id)
router.get('/canned', requirePermission('ticket', 'read'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await ticketService.getCannedResponses() });
}));
router.put('/canned', requirePermission('ticket', 'manage'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await ticketService.saveCannedResponses(req.body && req.body.items) });
}));

// GET /api/tickets/:id — detail + comments + activity
router.get('/:id', requirePermission('ticket', 'read'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await ticketService.getTicket(req.params.id, req.user) });
}));

// PATCH /api/tickets/:id — status / priority / assignee / category
router.patch('/:id', requirePermission('ticket', 'update'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await ticketService.updateTicket(req.params.id, req.body || {}, req.user) });
}));

// POST /api/tickets/:id/comments — worklog / reply (internal flag for staff notes)
router.post('/:id/comments', requirePermission('ticket', 'update'), asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, data: await ticketService.addComment(req.params.id, req.body || {}, req.user) });
}));

module.exports = router;
