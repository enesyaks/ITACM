/**
 * Self-service portal routes — a logged-in user's OWN zimmet.
 *
 * Gated by `authenticate` only: any signed-in account (including the
 * low-privilege Portal role) may read its own data, and nothing else. The
 * employee link is by email, resolved inside selfService.
 */
const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const { selfService } = require('../services');

router.use(authenticate);

/** GET /api/me/zimmet — assets, licenses and mobile lines assigned to the caller. */
router.get('/zimmet', asyncHandler(async (req, res) => {
  res.json({ success: true, data: await selfService.getMyZimmet(req.user) });
}));

module.exports = router;
