const router = require('express').Router();
const { authenticate, requireAnyPermission } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const { assetService, permissionService } = require('../services');
const { HttpError } = require('../utils/httpError');

router.use(authenticate);

/**
 * Context helper: asset id'den departman/lokasyon/kategori bilgisini çıkarır.
 * IAM constraint kontrolü için kullanılır.
 */
async function getAssetContext(req) {
  const id = req.params.id || req.body?.id;
  if (!id) return {};
  try {
    const asset = await assetService.getAsset(id);
    return {
      department: asset.department,
      location: asset.location,
      category: asset.category,
      cost: asset.purchase_cost,
    };
  } catch {
    return {};
  }
}

/**
 * Context helper: POST body'sinden kısıtlama bilgisi çıkarır.
 */
function getBodyContext(req) {
  const body = req.body || {};
  return {
    department: body.department,
    location: body.location,
    category: body.category,
    cost: body.purchase_cost,
  };
}

async function assetCaps(user) {
  const check = (action) => permissionService.checkPermission(user, 'asset', action);
  const [read, create, update, manage, unassign, assign] = await Promise.all([
    check('read'), check('create'), check('update'), check('manage'), check('unassign'), check('assign'),
  ]);
  // create/update ≠ list. Listing needs read | manage | assign | unassign.
  const canWrite = !!(manage || create || update);
  const canList = !!(read || manage || unassign || assign);
  const fullInventory = !!(read || manage);
  const unassignScopeOnly = !!(unassign && !assign && !fullInventory);
  const assignScopeOnly = !!(assign && !unassign && !fullInventory);
  const assignUnassignScopeOnly = !!(assign && unassign && !fullInventory);
  let forcedStatuses = null;
  if (unassignScopeOnly) forcedStatuses = ['In Stock'];
  else if (assignScopeOnly) forcedStatuses = ['Assigned'];
  else if (assignUnassignScopeOnly) forcedStatuses = ['In Stock', 'Assigned'];
  return {
    read, create, update, manage, unassign, assign,
    canWrite,
    canManage: canWrite, // write surface alias
    canList,
    fullInventory,
    unassignScopeOnly,
    assignScopeOnly,
    assignUnassignScopeOnly,
    forcedStatuses,
  };
}

function assertAssetInScope(caps, asset) {
  if (!caps.forcedStatuses) return;
  if (!caps.forcedStatuses.includes(asset.status)) {
    throw HttpError.forbidden(
      `Access denied: your asset scope only includes ${caps.forcedStatuses.join(' / ')}`
    );
  }
}

/** GET /api/assets — Hardware Inventory table.
 *  İzin: asset:read | manage | unassign | assign  (create/update alone do NOT list)
 *  Scoped (no read/manage):
 *    unassign → In Stock | assign → Assigned | both → In Stock + Assigned
 *  Query: sort=assetTag|brand|category|serialNumber|mac|location|status
 *         order=asc|desc
 */
router.get('/', asyncHandler(async (req, res) => {
  const caps = await assetCaps(req.user);
  if (!caps.canList) {
    throw HttpError.forbidden('Access denied: insufficient permissions for asset:read');
  }
  const query = { ...req.query };
  if (caps.forcedStatuses) {
    query.status = caps.forcedStatuses.join(',');
  }
  res.json({ success: true, data: await assetService.listAssets(query) });
}));

/** GET /api/assets/next-tag — preview of the next auto-assigned tag. İzin: asset:create */
router.get('/next-tag', requireAnyPermission([['asset', 'create']]), asyncHandler(async (req, res) => {
  res.json({ success: true, data: { nextTag: await assetService.nextAssetTag() } });
}));

/** GET /api/assets/:id — asset detail + audit history. */
router.get('/:id', asyncHandler(async (req, res) => {
  const caps = await assetCaps(req.user);
  if (!caps.canList) {
    throw HttpError.forbidden('Access denied: insufficient permissions for asset:read');
  }
  const asset = await assetService.getAsset(req.params.id);
  assertAssetInScope(caps, asset);
  res.json({ success: true, data: asset });
}));

/** GET /api/assets/:id/qr — server-generated QR code (PNG data URL, works offline). */
router.get('/:id/qr', asyncHandler(async (req, res) => {
  const caps = await assetCaps(req.user);
  if (!caps.canList) {
    throw HttpError.forbidden('Access denied: insufficient permissions for asset:read');
  }
  const asset = await assetService.getAsset(req.params.id);
  assertAssetInScope(caps, asset);
  const QRCode = require('qrcode');
  const dataUrl = await QRCode.toDataURL(asset.qrCodeString || asset.assetTag, {
    width: 260, margin: 1, errorCorrectionLevel: 'M',
  });
  res.json({ success: true, data: { assetTag: asset.assetTag, qrCodeString: asset.qrCodeString, dataUrl } });
}));

/** POST /api/assets — register hardware. İzin: asset:create */
router.post('/', requireAnyPermission([['asset', 'create']], getBodyContext), asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, data: await assetService.createAsset(req.body, req.user) });
}));

/** PUT /api/assets/:id — edit hardware. İzin: asset:update | manage */
router.put('/:id', requireAnyPermission([['asset', 'update'], ['asset', 'manage']], getAssetContext), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await assetService.updateAsset(req.params.id, req.body, req.user) });
}));

/** POST /api/assets/:id/return — Assigned → In Stock. İzin: asset:unassign | manage */
router.post('/:id/return', requireAnyPermission(
  [['asset', 'unassign'], ['asset', 'manage']],
  getAssetContext
), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await assetService.returnAsset(req.params.id, req.body, req.user) });
}));

module.exports = router;
