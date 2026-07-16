const router = require('express').Router();
const { authenticate, requireRole, requirePermission } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const { handoverService } = require('../services');

router.use(authenticate);

/**
 * POST /api/handovers — execute the atomic Handover Basket transaction. İzin: handover:create
 * Body: { employeeId, documentType: "single"|"separate",
 *         items: [{ assetId, conditionNote }],
 *         lines?: [{ lineId, conditionNote }],
 *         templateId?: string }
 * 409 with a conflict list if any asset is not In Stock or any line is already assigned.
 */
router.post('/', requirePermission('handover', 'create'), asyncHandler(async (req, res) => {
  const receipt = await handoverService.executeHandover(req.body, req.user);
  try {
    const { notificationService, webhookService } = require('../services');
    notificationService.notifyHandoverCompleted(receipt).catch(() => {});
    // Never put ackToken on the wire to third parties — it is a bearer secret.
    webhookService.emit('handover.completed', {
      handoverId: receipt.handoverId,
      employee: receipt.employee,
      itemCount: receipt.itemCount,
      ackPending: !!receipt.ackToken,
    }).catch(() => {});
  } catch { /* optional */ }
  res.status(201).json({ success: true, data: receipt });
}));

/** GET /api/handovers — recent receipts. İzin: handover:read */
router.get('/', requirePermission('handover', 'read'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await handoverService.listHandovers(req.query) });
}));

/** GET /api/handovers/:id/ack-link — staff-only token for employee acknowledgement URL. */
router.get('/:id/ack-link', requirePermission('handover', 'update'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await handoverService.getAckLink(req.params.id) });
}));

/** GET /api/handovers/:id/pdf — download the receipt as a real PDF file. İzin: handover:read */
router.get('/:id/pdf', requirePermission('handover', 'read'), asyncHandler(async (req, res) => {
  const { buildReceiptPdf } = require('../utils/handoverArchive');
  const lang = String(req.query.lang || '').slice(0, 5);
  const templateId = req.query.templateId ? String(req.query.templateId).slice(0, 64) : undefined;
  const { buffer, filename } = await buildReceiptPdf(
    req.params.id,
    req.user.username || req.user.email,
    lang || undefined,
    templateId
  );
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', require('../utils/contentDisposition').contentDisposition(filename));
  res.send(buffer);
}));

/** GET /api/handovers/:id — one receipt, feeds the Print Preview. İzin: handover:read */
router.get('/:id', requirePermission('handover', 'read'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await handoverService.getHandover(req.params.id) });
}));

module.exports = router;
