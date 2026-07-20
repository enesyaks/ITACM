/**
 * Onboarding & branding settings.
 *
 * POST /api/setup — PUBLIC but one-shot: requires setupToken + transactional
 * onboarded lock. Sets company branding and Admin credentials once.
 *
 * PUT /api/settings — Admin-only branding updates afterwards.
 */
const router = require('express').Router();
const { authenticate, requireRole, requirePermission } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const { authProvider, settingsService, migrationService } = require('../services');
const { canRevealSetupToken, rateLimitIp } = require('../utils/setupAccess');
const { HttpError } = require('../utils/httpError');

// Migrate endpoint: cap total POSTs + failed token attempts per IP (hour window).
const migratePosts = new Map();
const migrateFails = new Map();
const MIGRATE_WINDOW_MS = 60 * 60 * 1000;
const MIGRATE_MAX_POSTS = 10;
const MIGRATE_MAX_FAILS = 5;

function migrateLimiter(req, _res, next) {
  const now = Date.now();
  const ipKey = rateLimitIp(req);
  req._migrateIpKey = ipKey;

  let posts = migratePosts.get(ipKey);
  if (!posts || now > posts.resetAt) {
    posts = { count: 0, resetAt: now + MIGRATE_WINDOW_MS };
    migratePosts.set(ipKey, posts);
  }
  if (posts.count >= MIGRATE_MAX_POSTS) {
    return next(HttpError.tooMany('Too many migration attempts — try again later'));
  }
  posts.count += 1;

  let fails = migrateFails.get(ipKey);
  if (!fails || now > fails.resetAt) {
    fails = { count: 0, resetAt: now + MIGRATE_WINDOW_MS };
    migrateFails.set(ipKey, fails);
  }
  if (fails.count >= MIGRATE_MAX_FAILS) {
    return next(HttpError.tooMany('Too many failed setup token attempts — try again later'));
  }
  req._migrateFailEntry = fails;

  if (migratePosts.size > 10000) migratePosts.clear();
  if (migrateFails.size > 10000) migrateFails.clear();
  next();
}

function bumpMigrateFail(req) {
  if (req._migrateFailEntry) req._migrateFailEntry.count += 1;
}

router.get('/setup/status', asyncHandler(async (req, res) => {
  const settings = await settingsService.getSettings();
  if (settings.onboarded) {
    return res.json({ success: true, data: { onboarded: true } });
  }
  const setupToken = await settingsService.ensureSetupToken();
  if (canRevealSetupToken(req)) {
    return res.json({ success: true, data: { onboarded: false, setupToken } });
  }
  // Remote clients: do not leak the token. UI must paste SETUP_TOKEN / log key.
  res.json({
    success: true,
    data: { onboarded: false, setupTokenRequired: true },
  });
}));

router.post('/setup', asyncHandler(async (req, res) => {
  const {
    setupToken, companyName, companyLogo, companyAddress, adminUsername, adminEmail, adminPassword, language,
    handoverTemplates, defaultTemplateId, assetTagPrefix,
  } = req.body || {};

  const { settings, admin } = await settingsService.completeSetup(
    setupToken,
    { companyName, companyLogo, companyAddress, language, handoverTemplates, defaultTemplateId, assetTagPrefix },
    (client) => authProvider.upsertAdminTx(client, {
      username: adminUsername,
      email: adminEmail,
      password: adminPassword,
    })
  );

  res.status(201).json({
    success: true,
    data: { settings, admin: { email: admin.email, username: admin.username } },
  });
}));


// Fresh-install only: stream a migration package body and restore DB + documents.
// Token must be validated BEFORE upload (DoS / disk-fill prevention). Header only.
router.post('/setup/migrate', migrateLimiter, asyncHandler(async (req, res) => {
  const setupToken = String(req.get('X-Setup-Token') || '').trim();
  try {
    await migrationService.assertImportAllowed(setupToken);
  } catch (err) {
    if (err && (err.status === 403 || err.status === 400)) bumpMigrateFail(req);
    throw err;
  }
  const uploaded = await migrationService.saveUploadStream(req);
  try {
    const result = await migrationService.importFromArchive(uploaded.path, setupToken);
    res.json({ success: true, data: result });
  } catch (err) {
    try { require('fs').unlinkSync(uploaded.path); } catch { /* ignore */ }
    throw err;
  }
}));

// Branding & company-level settings are Owner-only. Operational lists
// (lifecycles, locations, specOptions) are managed by staff via /api/catalog.
router.put('/settings', authenticate, requirePermission('settings', 'manage'), asyncHandler(async (req, res) => {
  const {
    companyName, companyLogo, companyAddress, handoverTerms, defaultLocation, documentStorage,
    handoverTemplate, handoverTemplates, defaultTemplateId, language, currency, labelConfig,
    assetTagPrefix,
  } = req.body || {};
  const saved = await settingsService.saveSettings({
    companyName, companyLogo, companyAddress, handoverTerms, defaultLocation, documentStorage,
    handoverTemplate, handoverTemplates, defaultTemplateId, language, currency, labelConfig,
    assetTagPrefix,
  });
  res.json({ success: true, data: saved });
}));

module.exports = router;
