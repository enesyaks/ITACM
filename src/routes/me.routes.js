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
const { selfService, ticketService, settingsService } = require('../services');
const { HttpError } = require('../utils/httpError');

router.use(authenticate);

/** GET /api/me/zimmet — assets, licenses and mobile lines assigned to the caller. */
router.get('/zimmet', asyncHandler(async (req, res) => {
  res.json({ success: true, data: await selfService.getMyZimmet(req.user) });
}));

/* --- Self-service tickets: a user's OWN service-desk tickets (module-gated). --- */
const requireTicketing = asyncHandler(async (req, res, next) => {
  const s = await settingsService.getSettings();
  if (!s.ticketingEnabled) throw HttpError.notFound('The service desk module is not enabled');
  next();
});

router.get('/tickets', requireTicketing, asyncHandler(async (req, res) => {
  res.json({ success: true, data: await ticketService.listMyTickets(req.user) });
}));
router.post('/tickets', requireTicketing, asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, data: await ticketService.createMyTicket(req.body || {}, req.user) });
}));
router.get('/tickets/:id', requireTicketing, asyncHandler(async (req, res) => {
  res.json({ success: true, data: await ticketService.getMyTicket(req.params.id, req.user) });
}));
router.post('/tickets/:id/comments', requireTicketing, asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, data: await ticketService.addMyComment(req.params.id, req.body || {}, req.user) });
}));

module.exports = router;
