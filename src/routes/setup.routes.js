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
const { authProvider, settingsService } = require('../services');
const { canRevealSetupToken } = require('../utils/setupAccess');

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
    setupToken, companyName, companyLogo, adminUsername, adminEmail, adminPassword, language,
    handoverTemplates, defaultTemplateId,
  } = req.body || {};

  const { settings, admin } = await settingsService.completeSetup(
    setupToken,
    { companyName, companyLogo, language, handoverTemplates, defaultTemplateId },
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

// Branding & company-level settings are Owner-only. Operational lists
// (lifecycles, locations, specOptions) are managed by staff via /api/catalog.
router.put('/settings', authenticate, requirePermission('settings', 'manage'), asyncHandler(async (req, res) => {
  const {
    companyName, companyLogo, companyAddress, handoverTerms, defaultLocation, documentStorage,
    handoverTemplate, handoverTemplates, defaultTemplateId, language, currency, labelConfig,
  } = req.body || {};
  const saved = await settingsService.saveSettings({
    companyName, companyLogo, companyAddress, handoverTerms, defaultLocation, documentStorage,
    handoverTemplate, handoverTemplates, defaultTemplateId, language, currency, labelConfig,
  });
  res.json({ success: true, data: saved });
}));

module.exports = router;
