const router = require('express').Router();
const { authenticate, requireRole } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const { dashboardService } = require('../services');

/** GET /api/dashboard/stats — metric cards, low-stock + license alerts, recent activity. */
router.get(
  '/stats',
  authenticate,
  requireRole('Owner', 'Admin', 'Helpdesk', 'Viewer'),
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: await dashboardService.getDashboardStats() });
  })
);

module.exports = router;
