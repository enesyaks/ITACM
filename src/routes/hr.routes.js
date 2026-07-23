/**
 * HR onboarding/offboarding request routes.
 *
 * Every endpoint is gated by hr_request:<action> so a custom IAM group can
 * grant or withhold these surfaces the same way it does for every other
 * module. Role names never appear here.
 *
 * Read/cancel additionally enforce row ownership in the service layer: HR sees
 * only the tickets it filed, IT sees everything.
 */
const router = require('express').Router();
const { authenticate, requirePermission } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const { hrRequestService } = require('../services');

router.use(authenticate);

/** GET /api/hr/categories — allowed equipment checklist. İzin: hr_request:read */
router.get('/categories', requirePermission('hr_request', 'read'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: hrRequestService.EQUIPMENT_CATEGORIES });
}));

/** GET /api/hr/employees/search?q= — offboard target picker. İzin: hr_request:read */
router.get('/employees/search', requirePermission('hr_request', 'read'), asyncHandler(async (req, res) => {
  // `search` is what the shared employee picker sends; `q` is accepted too.
  const term = req.query.search != null ? req.query.search : req.query.q;
  const data = await hrRequestService.searchEmployeesForHr(term, req.query.limit);
  res.json({ success: true, data });
}));

/** GET /api/hr/requests?status=&type= — own tickets, or all for IT. İzin: hr_request:read */
router.get('/requests', requirePermission('hr_request', 'read'), asyncHandler(async (req, res) => {
  const scope = hrRequestService.listScopeForUser(req.user);
  const data = await hrRequestService.listRequests({
    status: req.query.status,
    type: req.query.type,
    createdBy: scope.createdBy,
    limit: req.query.limit,
  });
  res.json({ success: true, data });
}));

/** GET /api/hr/requests/:id. İzin: hr_request:read + ownership */
router.get('/requests/:id', requirePermission('hr_request', 'read'), asyncHandler(async (req, res) => {
  const data = await hrRequestService.getRequest(req.params.id);
  hrRequestService.assertCanSeeRequest(data, req.user);
  res.json({ success: true, data });
}));

/** POST /api/hr/onboard-requests. İzin: hr_request:create */
router.post('/onboard-requests', requirePermission('hr_request', 'create'), asyncHandler(async (req, res) => {
  const data = await hrRequestService.createOnboardRequest(req.body, req.user);
  res.status(201).json({ success: true, data });
}));

/** POST /api/hr/offboard-requests. İzin: hr_request:create */
router.post('/offboard-requests', requirePermission('hr_request', 'create'), asyncHandler(async (req, res) => {
  const data = await hrRequestService.createOffboardRequest(req.body, req.user);
  res.status(201).json({ success: true, data });
}));

/**
 * POST /api/hr/requests/:id/acknowledge — IT picks the ticket up. For onboard
 * tickets this provisions the employee + scheduled onboarding. İzin: hr_request:update
 */
router.post('/requests/:id/acknowledge', requirePermission('hr_request', 'update'), asyncHandler(async (req, res) => {
  const data = await hrRequestService.acknowledgeRequest(req.params.id, req.user);
  res.json({ success: true, data });
}));

/**
 * POST /api/hr/requests/:id/cancel — withdraw a pending ticket. Gated on read
 * because the requester must be able to undo their own mistake; the service
 * enforces "own ticket, or IT".  İzin: hr_request:read + ownership
 */
router.post('/requests/:id/cancel', requirePermission('hr_request', 'read'), asyncHandler(async (req, res) => {
  const data = await hrRequestService.cancelRequest(req.params.id, req.user, req.body && req.body.reason);
  res.json({ success: true, data });
}));

module.exports = router;
