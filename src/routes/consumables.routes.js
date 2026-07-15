const router = require('express').Router();
const { authenticate, requireRole, requirePermission } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const { consumableService } = require('../services');

router.use(authenticate);

/** GET /api/consumables — stock list with lowStock flags. İzin: consumable:read */
router.get('/', requirePermission('consumable', 'read'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await consumableService.listConsumables() });
}));

/** POST /api/consumables — register a consumable item. İzin: consumable:create */
router.post('/', requirePermission('consumable', 'create'), asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, data: await consumableService.createConsumable(req.body) });
}));

/** POST /api/consumables/:id/stock — atomic stock movement. İzin: consumable:update */
router.post('/:id/stock', requirePermission('consumable', 'update'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await consumableService.adjustStock(req.params.id, req.body.delta) });
}));

module.exports = router;
