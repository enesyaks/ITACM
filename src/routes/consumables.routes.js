const router = require('express').Router();
const { authenticate, requireRole } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const { consumableService } = require('../services');

router.use(authenticate);

/** GET /api/consumables — stock list with lowStock flags (all roles). */
router.get('/', asyncHandler(async (req, res) => {
  res.json({ success: true, data: await consumableService.listConsumables() });
}));

/** POST /api/consumables — register a consumable item (Admin/Helpdesk). */
router.post('/', requireRole('Owner', 'Admin', 'Helpdesk'), asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, data: await consumableService.createConsumable(req.body) });
}));

/** POST /api/consumables/:id/stock — atomic stock movement; body: { delta: -1 | 25 } (Admin/Helpdesk). */
router.post('/:id/stock', requireRole('Owner', 'Admin', 'Helpdesk'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await consumableService.adjustStock(req.params.id, req.body.delta) });
}));

module.exports = router;
