/**
 * Companies — the legal entities under one install (holding + subsidiaries).
 *
 * Two tiers, because the records mix two very different kinds of data:
 *
 *  - `/options` is open to any signed-in user and returns identifiers only
 *    (id, name, code, parent, default/active flags). Every asset and employee
 *    form has a company picker, so gating this would break those forms for
 *    every group that predates this feature.
 *  - The full records carry the entity's tax number, registered address,
 *    contact details, letterhead logo and handover terms. Those sit behind
 *    `settings:manage` — the same gate that guards company branding, and the
 *    same shape as catalog/org reads, which each require their own permission
 *    rather than bare authentication.
 */
const router = require('express').Router();
const { authenticate, requirePermission } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const { companyService } = require('../services');

router.use(authenticate);

/** GET /api/companies — full records (tax no, address, logo). İzin: settings:manage */
router.get('/', requirePermission('settings', 'manage'), asyncHandler(async (req, res) => {
  const withCounts = String(req.query.counts || '') === '1';
  const data = withCounts
    ? await companyService.listCompaniesWithCounts()
    : await companyService.listCompanies();
  res.json({ success: true, data });
}));

/**
 * GET /api/companies/options — the picker list every form needs: identifiers
 * only, deliberately free of the branding and tax details the full record
 * carries. Any signed-in user (Portal accounts are refused upstream by the
 * self-service allowlist in middleware/auth.js).
 */
router.get('/options', asyncHandler(async (req, res) => {
  res.json({ success: true, data: await companyService.listCompanyOptions() });
}));

/** GET /api/companies/:id — one full record. İzin: settings:manage */
router.get('/:id', requirePermission('settings', 'manage'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await companyService.getCompany(req.params.id) });
}));

/** POST /api/companies — add an entity. İzin: settings:manage */
router.post('/', requirePermission('settings', 'manage'), asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, data: await companyService.createCompany(req.body) });
}));

/** PATCH /api/companies/:id — edit name, branding, parent, terms. İzin: settings:manage */
router.patch('/:id', requirePermission('settings', 'manage'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await companyService.updateCompany(req.params.id, req.body) });
}));

/** PUT /api/companies/:id/default — make this the fallback company. İzin: settings:manage */
router.put('/:id/default', requirePermission('settings', 'manage'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await companyService.setDefaultCompany(req.params.id) });
}));

/** DELETE /api/companies/:id — only when it owns nothing. İzin: settings:manage */
router.delete('/:id', requirePermission('settings', 'manage'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await companyService.deleteCompany(req.params.id) });
}));

module.exports = router;
