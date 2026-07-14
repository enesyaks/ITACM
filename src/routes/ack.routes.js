/** Public employee acknowledgement of a handover (no login). */
const router = require('express').Router();
const { asyncHandler } = require('../utils/asyncHandler');
const { handoverService } = require('../services');

router.get('/:token', asyncHandler(async (req, res) => {
  res.json({ success: true, data: await handoverService.getByAckToken(req.params.token) });
}));

router.post('/:token', asyncHandler(async (req, res) => {
  const meta = { ip: req.ip };
  res.json({
    success: true,
    data: await handoverService.confirmAck(req.params.token, req.body || {}, meta),
  });
}));

module.exports = router;
