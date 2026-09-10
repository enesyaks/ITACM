/**
 * Service desk (ITIL) — staff endpoints. Every route needs the `ticket`
 * permission AND the optional module to be switched on (else 404, as if absent).
 * Employees raise their own tickets via /api/me/tickets (me.routes.js).
 */
const express = require('express');
const router = express.Router();
const { authenticate, requirePermission, requireAnyPermission } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const { ticketService, ticketRuleService, settingsService, documentService } = require('../services');
const { validateUpload } = require('../utils/uploadGuard');
const { contentDisposition } = require('../utils/contentDisposition');
const { HttpError } = require('../utils/httpError');

// Gate the whole module: when ticketing is off, behave as if the routes don't exist.
const requireTicketing = asyncHandler(async (req, res, next) => {
  const s = await settingsService.getSettings();
  if (!s.ticketingEnabled) throw HttpError.notFound('The service desk module is not enabled');
  next();
});

router.use(authenticate, requireTicketing);

// GET /api/tickets — list (filters: status, type, assigneeUserId, open, assetId)
router.get('/', requirePermission('ticket', 'read'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await ticketService.listTickets({
    status: req.query.status,
    type: req.query.type,
    priority: req.query.priority,
    category: req.query.category,
    search: req.query.search,
    sort: req.query.sort,
    order: req.query.order,
    assigneeUserId: req.query.assignee,
    assetId: req.query.assetId,
    open: req.query.open === '1' || req.query.open === 'true',
    limit: req.query.limit,
  }) });
}));

// POST /api/tickets — open a ticket
router.post('/', requirePermission('ticket', 'create'), asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, data: await ticketService.createTicket(req.body || {}, req.user) });
}));

// GET /api/tickets/stats — KPI counts for the service-desk strip (before /:id)
router.get('/stats', requirePermission('ticket', 'read'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await ticketService.stats() });
}));

// GET /api/tickets/report?from=&to= — ITIL service-desk report (before /:id)
router.get('/report', requireAnyPermission([['ticket', 'report'], ['ticket', 'manage']]), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await ticketService.report({ from: req.query.from, to: req.query.to }) });
}));
// GET /api/tickets/report/sla?from=&to= — one row per ticket, both SLA clocks
// beside their targets. Feeds the SLA export; same gate as the report itself.
router.get('/report/sla', requireAnyPermission([['ticket', 'report'], ['ticket', 'manage']]), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await ticketService.slaDetail({ from: req.query.from, to: req.query.to }) });
}));

/**
 * Advanced reporting. Sections are resolved per permission rather than gated as
 * a whole: the inventory half belongs to the asset module, so a user with
 * ticket:report but no asset:read gets the service-desk sheets and nothing else
 * instead of a refusal.
 */
async function advancedSections(user) {
  const { permissionService } = require('../services');
  const [rep, manage, assets] = await Promise.all([
    permissionService.checkPermission(user, 'ticket', 'report'),
    permissionService.checkPermission(user, 'ticket', 'manage'),
    permissionService.checkPermission(user, 'asset', 'read'),
  ]);
  return { serviceDesk: !!(rep || manage), inventory: !!assets };
}

// GET /api/tickets/report/advanced?from=&to= — breakdowns behind the summary
router.get('/report/advanced', requireAnyPermission([['ticket', 'report'], ['ticket', 'manage']]), asyncHandler(async (req, res) => {
  const { analyticsService } = require('../services');
  const sections = await advancedSections(req.user);
  res.json({
    success: true,
    data: await analyticsService.advancedReport({ from: req.query.from, to: req.query.to, sections }),
  });
}));

// GET /api/tickets/report/advanced.xlsx?from=&to= — the same thing as a workbook
router.get('/report/advanced.xlsx', requireAnyPermission([['ticket', 'report'], ['ticket', 'manage']]), asyncHandler(async (req, res) => {
  const { analyticsService, settingsService } = require('../services');
  const sections = await advancedSections(req.user);
  const data = await analyticsService.advancedReport({ from: req.query.from, to: req.query.to, sections });
  const settings = await settingsService.getSettings().catch(() => ({}));
  const { buildAdvancedReportXlsx } = require('../utils/reportXlsx');
  const buffer = await buildAdvancedReportXlsx(data, {
    companyName: settings.companyName, generatedAt: new Date(),
  });
  const filename = `itacm-rapor-${data.from}_${data.to}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', require('../utils/contentDisposition').contentDisposition(filename));
  res.send(buffer);
}));

// GET /api/tickets/report/agent?userId=&from=&to= — per-agent drill-down
router.get('/report/agent', requireAnyPermission([['ticket', 'report'], ['ticket', 'manage']]), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await ticketService.agentReport({ userId: req.query.userId, from: req.query.from, to: req.query.to }) });
}));

// GET/PUT /api/tickets/sla — effective SLA targets / save overrides (before /:id)
router.get('/sla', requirePermission('ticket', 'read'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await ticketService.getSlaConfig() });
}));
router.put('/sla', requireAnyPermission([['ticket', 'configure'], ['ticket', 'manage']]), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await ticketService.saveSlaConfig(req.body || {}) });
}));

// GET/PUT /api/tickets/workflow — the editable status transition map (before /:id)
router.get('/workflow', requirePermission('ticket', 'read'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await ticketService.getWorkflow() });
}));
router.put('/workflow', requireAnyPermission([['ticket', 'configure'], ['ticket', 'manage']]), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await ticketService.saveWorkflow(req.body || {}) });
}));
router.post('/workflow/reset', requireAnyPermission([['ticket', 'configure'], ['ticket', 'manage']]), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await ticketService.resetWorkflow() });
}));

// GET /api/tickets/categories — managed + used categories for the pickers (before /:id)
router.get('/categories', requirePermission('ticket', 'read'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await ticketService.categories() });
}));
// GET/PUT /api/tickets/categories/manage — the admin-curated category list.
router.get('/categories/manage', requirePermission('ticket', 'read'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await ticketService.getManagedCategories() });
}));
router.put('/categories/manage', requirePermission('ticket', 'manage'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await ticketService.saveManagedCategories((req.body && req.body.items) || []) });
}));

/* ---- Automation rules: "when a ticket is opened, if X then Y" ---- */

// GET /api/tickets/rules — the ordered rule set (before /:id)
// Reading the rules is a configuration view, not a ticket view: the set carries
// internal triage notes and who work is routed to, so it follows `configure`
// rather than `read` (which every Viewer holds).
router.get('/rules', requireAnyPermission([['ticket', 'configure'], ['ticket', 'manage']]), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await ticketRuleService.listRules() });
}));
// PUT /api/tickets/rules — replace the whole set (order = array index)
router.put('/rules', requireAnyPermission([['ticket', 'configure'], ['ticket', 'manage']]), asyncHandler(async (req, res) => {
  const actorName = (req.user && (req.user.username || req.user.email)) || null;
  res.json({ success: true, data: await ticketRuleService.saveRules((req.body && req.body.items) || [], actorName, req.user) });
}));
// POST /api/tickets/rules/test — dry-run a sample ticket against the saved
// rules, or against the unsaved draft the editor sends in `items`.
router.post('/rules/test', requireAnyPermission([['ticket', 'configure'], ['ticket', 'manage']]), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await ticketRuleService.testRules((req.body && req.body.sample) || {}, req.body && req.body.items) });
}));

// GET/PUT /api/tickets/canned — quick-reply templates (before /:id)
router.get('/canned', requirePermission('ticket', 'read'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await ticketService.getCannedResponses() });
}));
router.put('/canned', requirePermission('ticket', 'manage'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await ticketService.saveCannedResponses(req.body && req.body.items) });
}));

/* ---- Attachments (reuse the vetted document store + document:* IAM) ---- */

// GET /api/tickets/documents/:docId/download (before /:id)
router.get('/documents/:docId/download', requirePermission('document', 'download'), asyncHandler(async (req, res) => {
  const doc = await documentService.getTicketDoc(req.params.docId);
  const inline = String(req.query.view || '') === '1' || String(req.query.inline || '') === '1';
  res.setHeader('Content-Type', doc.mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', contentDisposition(doc.filename, { inline }));
  res.send(doc.buffer);
}));

// DELETE /api/tickets/documents/:docId
router.delete('/documents/:docId', requirePermission('document', 'delete'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await documentService.deleteTicketDoc(req.params.docId) });
}));

// GET /api/tickets/:id/documents — list attachments
router.get('/:id/documents', requirePermission('document', 'read'), asyncHandler(async (req, res) => {
  await ticketService.getTicket(req.params.id, req.user); // 404s if the ticket is gone
  res.json({ success: true, data: await documentService.listTicketDocs(req.params.id) });
}));

// POST /api/tickets/:id/documents — attach a file (base64, sniffed + size-capped by uploadGuard)
router.post('/:id/documents', requireAnyPermission([['document', 'upload'], ['document', 'create']]), express.json({ limit: '12mb' }), asyncHandler(async (req, res) => {
  const ticket = await ticketService.getTicket(req.params.id, req.user);
  const { buffer, mime, filename } = validateUpload(req.body || {});
  const saved = await documentService.saveTicketDoc({
    ticketId: ticket.id, filename, mime, buffer,
    uploadedBy: req.user.uid, uploadedByName: req.user.username || req.user.email,
    internal: !!(req.body && req.body.internal),
    staffOnly: !!(req.body && req.body.staffOnly),
    commentId: (req.body && req.body.commentId) || null,
  });
  res.status(201).json({ success: true, data: saved });
}));

// GET /api/tickets/:id — detail + comments + activity
router.get('/:id', requirePermission('ticket', 'read'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await ticketService.getTicket(req.params.id, req.user) });
}));

// PATCH /api/tickets/:id — status / priority / assignee / category
router.patch('/:id', requirePermission('ticket', 'update'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await ticketService.updateTicket(req.params.id, req.body || {}, req.user) });
}));

// POST /api/tickets/:id/comments — worklog / reply (internal flag for staff notes)
router.post('/:id/comments', requirePermission('ticket', 'update'), asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, data: await ticketService.addComment(req.params.id, req.body || {}, req.user) });
}));

// POST /api/tickets/:id/spam — an advert got through the filter: classify it,
// close it, take the SLA clock off it, and (optionally) block the sender.
router.post('/:id/spam', requirePermission('ticket', 'update'), asyncHandler(async (req, res) => {
  const body = req.body || {};
  res.json({ success: true, data: await ticketService.markSpam(req.params.id, {
    block: !!body.block, category: body.category,
  }, req.user) });
}));

// POST /api/tickets/:id/links — mark other tickets as duplicates of this one,
// so closing this one closes them. DELETE detaches a single follower.
router.post('/:id/links', requirePermission('ticket', 'update'), asyncHandler(async (req, res) => {
  const body = req.body || {};
  const ids = body.ticketIds != null ? body.ticketIds : body.ticketId;
  res.json({ success: true, data: await ticketService.linkTickets(req.params.id, ids, req.user) });
}));

router.delete('/:id/links/:childId', requirePermission('ticket', 'update'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await ticketService.unlinkTicket(req.params.id, req.params.childId, req.user) });
}));

// POST /api/tickets/:id/send-approval — route the ticket to the requester's
// manager / skip-level / department manager for sign-off.
router.post('/:id/send-approval', requirePermission('ticket', 'update'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await ticketService.sendToApproval(req.params.id, req.body || {}, req.user) });
}));

module.exports = router;
