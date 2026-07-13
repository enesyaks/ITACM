const router = require('express').Router();
const { authenticate, requireRole } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const { licenseService } = require('../services');

router.use(authenticate);

const privileged = (req) => licenseService.PRIVILEGED_ROLES.has(req.user.role);

/** GET /api/licenses — Software & Licenses table (all roles). */
router.get('/', asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: await licenseService.listLicenses({ ...req.query, privileged: privileged(req) }),
  });
}));

/** POST /api/licenses — register a license pool (Admin/Helpdesk). */
router.post('/', requireRole('Owner', 'Admin', 'Helpdesk'), asyncHandler(async (req, res) => {
  const lic = await licenseService.createLicense(req.body);
  if (!privileged(req)) lic.licenseKey = licenseService.maskLicenseKey(lic.licenseKey, false);
  res.status(201).json({ success: true, data: lic });
}));

/** POST /api/licenses/:id/seats — atomic seat claim/release; body: { delta: 1 | -1 } (Admin/Helpdesk). */
router.post('/:id/seats', requireRole('Owner', 'Admin', 'Helpdesk'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await licenseService.adjustSeats(req.params.id, req.body.delta) });
}));

/** GET /api/licenses/assignments — software zimmet list; ?employeeId=&licenseId=&includeRevoked= (all roles). */
router.get('/assignments', asyncHandler(async (req, res) => {
  res.json({ success: true, data: await licenseService.listAssignments(req.query) });
}));

/** POST /api/licenses/:id/assign — assign a seat to an employee; body: { employeeId } (Admin/Helpdesk). */
router.post('/:id/assign', requireRole('Owner', 'Admin', 'Helpdesk'), asyncHandler(async (req, res) => {
  res.status(201).json({
    success: true,
    data: await licenseService.assignLicense(req.params.id, req.body.employeeId, req.user),
  });
}));

/** GET /api/licenses/:id/assignments — active assignments of one license (all roles). */
router.get('/:id/assignments', asyncHandler(async (req, res) => {
  res.json({ success: true, data: await licenseService.listAssignments({ ...req.query, licenseId: req.params.id }) });
}));

/** POST /api/licenses/assignments/:aid/revoke — software zimmet düşürme (Admin/Helpdesk). */
router.post('/assignments/:aid/revoke', requireRole('Owner', 'Admin', 'Helpdesk'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await licenseService.revokeAssignment(req.params.aid, req.user) });
}));

module.exports = router;
