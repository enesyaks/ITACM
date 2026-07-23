const router = require('express').Router();
const { authenticate, requireRole, requirePermission } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const { dashboardService } = require('../services');

/** GET /api/dashboard/stats — metric cards, low-stock + license alerts, recent activity. */
router.get(
  '/stats',
  authenticate,
  requirePermission('dashboard', 'read'),
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: await dashboardService.getDashboardStats() });
  })
);

/**
 * GET /api/dashboard/hr-stats — pending HR ticket counters, scoped per caller.
 * İzin: hr_request:read (same gate as the ticket list it summarises).
 */
router.get(
  '/hr-stats',
  authenticate,
  requirePermission('hr_request', 'read'),
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: await dashboardService.getHrDashboardStats(req.user) });
  })
);

module.exports = router;

