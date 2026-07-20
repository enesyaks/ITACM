/**
 * System migration export (Owner only — dumps password hashes / SMTP secrets).
 * GET /api/migrations/export → itacm-migrate-v1 .tar.gz download
 *
 * Mounted from: src/app.js as /api/migrations
 */
const router = require('express').Router();
const fs = require('fs');
const path = require('path');
const { authenticate, requireRole, requirePermission } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const { migrationService } = require('../services');

router.get(
  '/export',
  authenticate,
  requireRole('Owner'),
  requirePermission('settings', 'manage'),
  asyncHandler(async (req, res) => {
    const { archivePath, pkgDir, manifest } = await migrationService.createExportPackage();
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      migrationService.cleanupExportArtifacts({ archivePath, pkgDir });
    };
    const filename = path.basename(archivePath);
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    if (manifest) {
      res.setHeader('X-ITACM-Migrate-Format', manifest.format || 'itacm-migrate-v1');
      res.setHeader('X-ITACM-Migrate-Created', manifest.createdAt || '');
    }
    const stream = fs.createReadStream(archivePath);
    stream.on('error', (err) => {
      cleanup();
      if (!res.headersSent) res.status(500).json({ success: false, error: err.message });
      else res.destroy(err);
    });
    res.on('finish', cleanup);
    res.on('close', cleanup);
    stream.pipe(res);
  })
);

module.exports = router;
