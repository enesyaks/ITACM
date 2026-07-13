const router = require('express').Router();
const { authenticate, requireRole } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const { assetService } = require('../services');

router.use(authenticate);

/** GET /api/assets — Hardware Inventory table (all roles). ?status=&category=&search=&location=&limit=&cursor= */
router.get('/', asyncHandler(async (req, res) => {
  res.json({ success: true, data: await assetService.listAssets(req.query) });
}));

/** GET /api/assets/next-tag — preview of the next auto-assigned tag (all roles). */
router.get('/next-tag', asyncHandler(async (req, res) => {
  res.json({ success: true, data: { nextTag: await assetService.nextAssetTag() } });
}));

/** GET /api/assets/:id — asset detail + audit history (all roles). */
router.get('/:id', asyncHandler(async (req, res) => {
  res.json({ success: true, data: await assetService.getAsset(req.params.id) });
}));

/** GET /api/assets/:id/qr — server-generated QR code (PNG data URL, works offline). */
router.get('/:id/qr', asyncHandler(async (req, res) => {
  const QRCode = require('qrcode');
  const asset = await assetService.getAsset(req.params.id);
  const dataUrl = await QRCode.toDataURL(asset.qrCodeString || asset.assetTag, {
    width: 260, margin: 1, errorCorrectionLevel: 'M',
  });
  res.json({ success: true, data: { assetTag: asset.assetTag, qrCodeString: asset.qrCodeString, dataUrl } });
}));

/** POST /api/assets — register hardware (Admin/Helpdesk). */
router.post('/', requireRole('Owner', 'Admin', 'Helpdesk'), asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, data: await assetService.createAsset(req.body, req.user) });
}));

/** PUT /api/assets/:id — edit hardware (Admin/Helpdesk). */
router.put('/:id', requireRole('Owner', 'Admin', 'Helpdesk'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await assetService.updateAsset(req.params.id, req.body, req.user) });
}));

/** POST /api/assets/:id/return — take an assigned asset back into stock (Admin/Helpdesk). */
router.post('/:id/return', requireRole('Owner', 'Admin', 'Helpdesk'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await assetService.returnAsset(req.params.id, req.body, req.user) });
}));

module.exports = router;
