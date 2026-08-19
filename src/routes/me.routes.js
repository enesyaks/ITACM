/**
 * Self-service portal routes — a logged-in user's OWN zimmet.
 *
 * Gated by `authenticate` only: any signed-in account (including the
 * low-privilege Portal role) may read its own data, and nothing else. The
 * employee link is by email, resolved inside selfService.
 */
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const { selfService, ticketService, settingsService, documentService } = require('../services');
const { validateUpload } = require('../utils/uploadGuard');
const { contentDisposition } = require('../utils/contentDisposition');
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
router.post('/tickets/:id/csat', requireTicketing, asyncHandler(async (req, res) => {
  res.json({ success: true, data: await ticketService.submitMyCsat(req.params.id, req.body || {}, req.user) });
}));

/* Own-ticket attachments. getMyTicket enforces ownership (403 if not the
   requester); the Portal only ever sees/uploads NON-internal files. */
router.get('/tickets/:id/documents/:docId/download', requireTicketing, asyncHandler(async (req, res) => {
  await ticketService.getMyTicket(req.params.id, req.user); // ownership gate (throws otherwise)
  const doc = await documentService.getTicketDoc(req.params.docId);
  if (String(doc.ticketId) !== String(req.params.id) || doc.internal) throw HttpError.notFound('Attachment not found');
  res.setHeader('Content-Type', doc.mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', contentDisposition(doc.filename, { inline: true }));
  res.send(doc.buffer);
}));
router.get('/tickets/:id/documents', requireTicketing, asyncHandler(async (req, res) => {
  await ticketService.getMyTicket(req.params.id, req.user);
  res.json({ success: true, data: await documentService.listTicketDocs(req.params.id, { publicOnly: true }) });
}));
router.post('/tickets/:id/documents', requireTicketing, express.json({ limit: '12mb' }), asyncHandler(async (req, res) => {
  const ticket = await ticketService.getMyTicket(req.params.id, req.user);
  const { buffer, mime, filename } = validateUpload(req.body || {});
  const saved = await documentService.saveTicketDoc({
    ticketId: ticket.id, filename, mime, buffer,
    uploadedBy: req.user.uid, uploadedByName: req.user.username || req.user.email,
    internal: false, // employees can never post internal attachments
  });
  res.status(201).json({ success: true, data: saved });
}));

module.exports = router;
