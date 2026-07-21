const router = require('express').Router();
const { authenticate, requireRole, requirePermission } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const { catalogService, settingsService, orgService } = require('../services');
const { HttpError } = require('../utils/httpError');

router.use(authenticate);

/** GET /api/catalog — brand/model catalog feeding the asset form. İzin: catalog:read */
router.get('/', requirePermission('catalog', 'read'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await catalogService.listCatalog() });
}));

/** POST /api/catalog — add a brand/model entry. İzin: catalog:create */
router.post('/', requirePermission('catalog', 'create'), asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, data: await catalogService.addCatalogEntry(req.body) });
}));

/** POST /api/catalog/import — bootstrap the catalog from existing assets. İzin: catalog:create */
router.post('/import', requirePermission('catalog', 'create'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await catalogService.importFromAssets() });
}));

/** DELETE /api/catalog/:id — remove an entry. İzin: catalog:delete */
router.delete('/:id', requirePermission('catalog', 'delete'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await catalogService.removeCatalogEntry(req.params.id) });
}));

/* ---- Office locations (stored in settings, managed from the Catalog UI) ---- */

/** GET /api/catalog/locations — location list + default. İzin: catalog:read */
router.get('/locations', requirePermission('catalog', 'read'), asyncHandler(async (req, res) => {
  const s = await settingsService.getSettings();
  res.json({ success: true, data: { locations: s.locations, defaultLocation: s.defaultLocation } });
}));

/** POST /api/catalog/locations — add a location. İzin: catalog:create */
router.post('/locations', requirePermission('catalog', 'create'), asyncHandler(async (req, res) => {
  const name = String((req.body || {}).name || '').trim();
  if (!name || name.length > 60) throw HttpError.badRequest('Location name is required (max 60 chars)');
  const s = await settingsService.getSettings();
  if (s.locations.some((l) => l.toLowerCase() === name.toLowerCase())) {
    throw HttpError.conflict(`Location "${name}" already exists`);
  }
  const saved = await settingsService.saveSettings({ locations: [...s.locations, name] });
  res.status(201).json({ success: true, data: { locations: saved.locations, defaultLocation: saved.defaultLocation } });
}));

/** PUT /api/catalog/locations/default — set the default location. İzin: catalog:update */
router.put('/locations/default', requirePermission('catalog', 'update'), asyncHandler(async (req, res) => {
  const name = (req.body || {}).name ?? null;
  const s = await settingsService.getSettings();
  if (name !== null && !s.locations.includes(name)) throw HttpError.badRequest('Unknown location');
  const saved = await settingsService.saveSettings({ defaultLocation: name });
  res.json({ success: true, data: { locations: saved.locations, defaultLocation: saved.defaultLocation } });
}));

/** DELETE /api/catalog/locations/:name — remove a location. İzin: catalog:delete */
router.delete('/locations/:name', requirePermission('catalog', 'delete'), asyncHandler(async (req, res) => {
  const name = req.params.name;
  const s = await settingsService.getSettings();
  if (!s.locations.includes(name)) throw HttpError.notFound(`Location "${name}" not found`);
  if (s.locations.length <= 1) throw HttpError.badRequest('At least one location must remain');
  const saved = await settingsService.saveSettings({
    locations: s.locations.filter((l) => l !== name),
    defaultLocation: s.defaultLocation === name ? null : undefined,
  });
  res.json({ success: true, data: { locations: saved.locations, defaultLocation: saved.defaultLocation } });
}));

/* ---- Hardware spec lists (cpu / ram / storage) — feed the asset form ---- */

/** GET /api/catalog/lifecycles — per-category lifecycle durations. İzin: catalog:read */
router.get('/lifecycles', requirePermission('catalog', 'read'), asyncHandler(async (req, res) => {
  const st = await settingsService.getSettings();
  res.json({ success: true, data: st.lifecycles });
}));

/** PUT /api/catalog/lifecycles — update lifecycle durations. İzin: catalog:update */
router.put('/lifecycles', requirePermission('catalog', 'update'), asyncHandler(async (req, res) => {
  const saved = await settingsService.saveSettings({ lifecycles: req.body || {} });
  res.json({ success: true, data: saved.lifecycles });
}));

/** GET /api/catalog/specs — all three lists. İzin: catalog:read */
router.get('/specs', requirePermission('catalog', 'read'), asyncHandler(async (req, res) => {
  const s = await settingsService.getSettings();
  res.json({ success: true, data: s.specOptions });
}));

/** POST /api/catalog/specs — add an entry; body: { type: cpu|ram|storage, value }. İzin: catalog:create */
router.post('/specs', requirePermission('catalog', 'create'), asyncHandler(async (req, res) => {
  const { type, value } = req.body || {};
  const val = String(value || '').trim();
  if (!['cpu', 'ram', 'storage'].includes(type)) throw HttpError.badRequest('type must be cpu, ram or storage');
  if (!val || val.length > 60) throw HttpError.badRequest('value is required (max 60 chars)');
  const s = await settingsService.getSettings();
  if (s.specOptions[type].some((v) => v.toLowerCase() === val.toLowerCase())) {
    throw HttpError.conflict(`"${val}" already exists in the ${type.toUpperCase()} list`);
  }
  const saved = await settingsService.saveSettings({
    specOptions: { ...s.specOptions, [type]: [...s.specOptions[type], val] },
  });
  res.status(201).json({ success: true, data: saved.specOptions });
}));

/** DELETE /api/catalog/specs/:type/:value — remove an entry. İzin: catalog:delete */
router.delete('/specs/:type/:value', requirePermission('catalog', 'delete'), asyncHandler(async (req, res) => {
  const { type, value } = req.params;
  if (!['cpu', 'ram', 'storage'].includes(type)) throw HttpError.badRequest('type must be cpu, ram or storage');
  const s = await settingsService.getSettings();
  if (!s.specOptions[type].includes(value)) throw HttpError.notFound(`"${value}" not found in ${type} list`);
  if (s.specOptions[type].length <= 1) throw HttpError.badRequest('At least one entry must remain');
  const saved = await settingsService.saveSettings({
    specOptions: { ...s.specOptions, [type]: s.specOptions[type].filter((v) => v !== value) },
  });
  res.json({ success: true, data: saved.specOptions });
}));

/* ---- Company departments (stored in settings, feed the employee form) ---- */

/** GET /api/catalog/departments — department list. İzin: catalog:read */
router.get('/departments', requirePermission('catalog', 'read'), asyncHandler(async (req, res) => {
  const s = await settingsService.getSettings();
  res.json({ success: true, data: s.departments });
}));

/** POST /api/catalog/departments — add a department. İzin: catalog:create
 *  Single source of truth: writes the `departments` table (org chart reads it too). */
router.post('/departments', requirePermission('catalog', 'create'), asyncHandler(async (req, res) => {
  const names = await orgService.addDepartment((req.body || {}).name);
  res.status(201).json({ success: true, data: names });
}));

/** DELETE /api/catalog/departments/:name — remove a department. İzin: catalog:delete */
router.delete('/departments/:name', requirePermission('catalog', 'delete'), asyncHandler(async (req, res) => {
  const names = await orgService.removeDepartment(req.params.name);
  res.json({ success: true, data: names });
}));

/* ---- Provider / contract categories (Providers & Contracts forms) ---- */

function listCrud(key, label) {
  return {
    async get(_req, res) {
      const s = await settingsService.getSettings();
      res.json({ success: true, data: s[key] });
    },
    async post(req, res) {
      const name = String((req.body || {}).name || '').trim();
      if (!name || name.length > 60) throw HttpError.badRequest(`${label} name is required (max 60 chars)`);
      const s = await settingsService.getSettings();
      if (s[key].some((d) => d.toLowerCase() === name.toLowerCase())) {
        throw HttpError.conflict(`${label} "${name}" already exists`);
      }
      const saved = await settingsService.saveSettings({ [key]: [...s[key], name] });
      res.status(201).json({ success: true, data: saved[key] });
    },
    async del(req, res) {
      const name = req.params.name;
      const s = await settingsService.getSettings();
      if (!s[key].includes(name)) throw HttpError.notFound(`${label} "${name}" not found`);
      if (s[key].length <= 1) throw HttpError.badRequest(`At least one ${label.toLowerCase()} must remain`);
      const saved = await settingsService.saveSettings({ [key]: s[key].filter((d) => d !== name) });
      res.json({ success: true, data: saved[key] });
    },
  };
}

const providerCats = listCrud('providerCategories', 'Provider category');
const contractCats = listCrud('contractCategories', 'Contract category');

router.get('/provider-categories', requirePermission('catalog', 'read'), asyncHandler(providerCats.get));
router.post('/provider-categories', requirePermission('catalog', 'create'), asyncHandler(providerCats.post));
router.delete('/provider-categories/:name', requirePermission('catalog', 'delete'), asyncHandler(providerCats.del));

router.get('/contract-categories', requirePermission('catalog', 'read'), asyncHandler(contractCats.get));
router.post('/contract-categories', requirePermission('catalog', 'create'), asyncHandler(contractCats.post));
router.delete('/contract-categories/:name', requirePermission('catalog', 'delete'), asyncHandler(contractCats.del));

/**
 * PUT /api/catalog/:id — update a catalog model's lifecycle (months). İzin: catalog:update
 * Registered last so it never shadows the literal PUT routes above (e.g. /lifecycles).
 */
router.put('/:id', requirePermission('catalog', 'update'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await catalogService.updateCatalogEntry(req.params.id, req.body || {}) });
}));

module.exports = router;
