const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const { importService } = require('../services');

router.use(authenticate);

/**
 * POST /api/import/inventory — Excel/CSV migration (Owner/Admin).
 * Body: { rows: [...], dryRun: true|false } — rows parsed client-side from the
 * template. Own 12MB parser (bypassed in app.js) for large sheets.
 */
router.post('/inventory', requireRole('Owner', 'Admin'), express.json({ limit: '12mb' }),
  asyncHandler(async (req, res) => {
    const { rows, dryRun } = req.body || {};
    res.json({ success: true, data: await importService.importInventory(rows, { dryRun: !!dryRun }, req.user) });
  }));

module.exports = router;
