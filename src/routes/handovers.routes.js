const router = require('express').Router();
const { authenticate, requireRole } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const { handoverService } = require('../services');

router.use(authenticate);

/**
 * POST /api/handovers — execute the atomic Handover Basket transaction (Admin/Helpdesk).
 * Body: { employeeId, documentType: "single"|"separate",
 *         items: [{ assetId, conditionNote }],
 *         lines?: [{ lineId, conditionNote }],
 *         templateId?: string }
 * 409 with a conflict list if any asset is not In Stock or any line is already assigned.
 */
router.post('/', requireRole('Owner', 'Admin', 'Helpdesk'), asyncHandler(async (req, res) => {
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

/** GET /api/handovers — recent receipts; ?employeeId= filters per employee (all roles). */
router.get('/', asyncHandler(async (req, res) => {
  res.json({ success: true, data: await handoverService.listHandovers(req.query) });
}));

/** GET /api/handovers/:id/ack-link — staff-only token for employee acknowledgement URL. */
router.get('/:id/ack-link', requireRole('Owner', 'Admin', 'Helpdesk'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await handoverService.getAckLink(req.params.id) });
}));

/** GET /api/handovers/:id/pdf — download the receipt as a real PDF file.
 *  Query: ?lang=&templateId= (templateId overrides the one stored on the handover). */
router.get('/:id/pdf', asyncHandler(async (req, res) => {
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

/** GET /api/handovers/:id — one receipt, feeds the Print Preview (Zimmet Tutanağı). */
router.get('/:id', asyncHandler(async (req, res) => {
  res.json({ success: true, data: await handoverService.getHandover(req.params.id) });
}));

module.exports = router;
