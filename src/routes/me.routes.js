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
const { selfService, ticketService, settingsService, documentService, requestTemplateService, approvalService } = require('../services');
const { validateUpload } = require('../utils/uploadGuard');
const { contentDisposition } = require('../utils/contentDisposition');
const { query } = require('../providers/postgres/pool');
const { HttpError } = require('../utils/httpError');

/** The signed-in user's employee record (by email), for approval routing. */
async function currentEmployee(req) {
  const email = String((req.user && req.user.email) || '').trim().toLowerCase();
  if (!email) return null;
  const { rows } = await query('SELECT id, full_name FROM employees WHERE lower(email) = $1 LIMIT 1', [email]);
  return rows[0] ? { id: rows[0].id, fullName: rows[0].full_name } : null;
}

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

/* Service-request templates the employee can raise (enabled only). */
router.get('/request-templates', requireTicketing, asyncHandler(async (req, res) => {
  const list = await requestTemplateService.listTemplates({ enabledOnly: true });
  res.json({ success: true, data: list.map((tpl) => ({ id: tpl.id, name: tpl.name, description: tpl.description, category: tpl.category })) });
}));

/* Approvals the employee (as a manager) must act on — Portal accounts are
   confined to /me/*, so managers approve here rather than /api/approvals. */
router.get('/approvals/pending', asyncHandler(async (req, res) => {
  const emp = await currentEmployee(req);
  res.json({ success: true, data: emp ? await approvalService.listPending(emp.id) : [] });
}));
router.post('/approvals/:id/decide', asyncHandler(async (req, res) => {
  const emp = await currentEmployee(req);
  res.json({ success: true, data: await approvalService.decide(req.params.id, {
    decision: req.body && req.body.decision,
    note: (req.body && req.body.note) || '',
    deciderName: (emp && emp.fullName) || (req.user && req.user.email) || 'Unknown',
    deciderEmployeeId: emp && emp.id,
    isAdmin: false,
  }) });
}));

module.exports = router;
