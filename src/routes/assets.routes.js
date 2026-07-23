const router = require('express').Router();
const { authenticate, requireAnyPermission } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const { assetService, permissionService, approvalService, webhookService } = require('../services');
const { HttpError } = require('../utils/httpError');
const { query: dbQuery } = require('../providers/postgres/pool');

router.use(authenticate);

/**
 * Disposing of hardware (sell / scrap) is the one asset edit that can require
 * sign-off. When policy asks for it the change is deferred: an approval request
 * is opened and offboardService.replayApproved() performs the disposal once the
 * chain signs off. Without this the policy was declared but never enforced.
 *
 * @returns {Promise<object|null>} pending-approval payload, or null to proceed
 */
async function disposalApprovalGate(req) {
  const next = req.body && req.body.status;
  if (next !== 'Sold' && next !== 'Scrap') return null;

  const { rows } = await dbQuery(
    'SELECT id, asset_tag, status, current_employee_id FROM assets WHERE id = $1',
    [req.params.id]
  );
  const asset = rows[0];
  if (!asset || asset.status === next) return null; // nothing to approve

  // Route through the acting user's own manager chain; fall back to the current
  // holder when the operator has no employee twin.
  const email = String((req.user && req.user.email) || '').trim().toLowerCase();
  let requesterEmployeeId = asset.current_employee_id || null;
  if (email) {
    const me = await dbQuery('SELECT id FROM employees WHERE lower(email) = $1 LIMIT 1', [email]);
    if (me.rows[0]) requesterEmployeeId = me.rows[0].id;
  }

  const ap = await approvalService.createRequest({
    type: next === 'Sold' ? 'asset_sale' : 'asset_scrap',
    requesterEmployeeId,
    requesterName: (req.user && (req.user.username || req.user.email)) || null,
    payload: {
      assetId: asset.id,
      sale: req.body && req.body.sale,
      note: req.body && req.body.note,
      itUser: { uid: req.user.uid, username: req.user.username, email: req.user.email },
    },
    resourceRef: asset.id,
    summary: `${next === 'Sold' ? 'Sell' : 'Scrap'} ${asset.asset_tag}`,
  });
  return ap.required ? { pendingApproval: true, request: ap.request } : null;
}

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
  const pending = await disposalApprovalGate(req);
  if (pending) return res.status(202).json({ success: true, data: pending });
  const updated = await assetService.updateAsset(req.params.id, req.body, req.user);
  // 'asset.updated' is an advertised webhook event; without this emit the
  // Integrations screen accepted subscriptions that never fired.
  webhookService.emit('asset.updated', {
    assetId: updated.id,
    assetTag: updated.assetTag,
    status: updated.status,
    category: updated.category,
    updatedBy: (req.user && (req.user.username || req.user.email)) || null,
  });
  res.json({ success: true, data: updated });
}));

/** POST /api/assets/:id/return — Assigned → In Stock. İzin: asset:unassign | manage */
router.post('/:id/return', requireAnyPermission(
  [['asset', 'unassign'], ['asset', 'manage']],
  getAssetContext
), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await assetService.returnAsset(req.params.id, req.body, req.user) });
}));

module.exports = router;
