const express = require('express');
const router = express.Router();
const { authenticate, requireRole, requirePermission } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const { importService } = require('../services');

router.use(authenticate);

/**
 * POST /api/import/inventory — Excel/CSV migration. İzin: asset:import (import = özel aksiyon).
 * Owner/Admin yetkisiyle birebir uyumlu.
 */
router.post('/inventory', requirePermission('asset', 'import'), express.json({ limit: '12mb' }),
  asyncHandler(async (req, res) => {
    const { rows, dryRun } = req.body || {};
    res.json({ success: true, data: await importService.importInventory(rows, { dryRun: !!dryRun }, req.user) });
  }));

module.exports = router;
