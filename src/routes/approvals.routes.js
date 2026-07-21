const router = require('express').Router();
const { authenticate, requireRole } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const { approvalService, settingsService } = require('../services');
const { query } = require('../providers/postgres/pool');

router.use(authenticate);

/** Map the signed-in user to their employee record (by email), if any. */
async function currentEmployee(req) {
  const email = String((req.user && req.user.email) || '').trim().toLowerCase();
  if (!email) return null;
  const { rows } = await query('SELECT id, full_name FROM employees WHERE lower(email) = $1 LIMIT 1', [email]);
  return rows[0] ? { id: rows[0].id, fullName: rows[0].full_name } : null;
}

const isAdmin = (req) => ['Owner', 'Admin'].includes(req.user && req.user.role);

/* ------------------------- Feature flag / policy ------------------------- */

/** GET /api/approvals/config — current enabled state + per-action policy. */
router.get('/config', asyncHandler(async (req, res) => {
  res.json({ success: true, data: await approvalService.getConfig() });
}));

/** PUT /api/approvals/config — turn the workflow on/off and set the policy. Owner/Admin only. */
router.put('/config', requireRole('Owner', 'Admin'), asyncHandler(async (req, res) => {
  const cur = await approvalService.getConfig();
  const body = req.body || {};
  const next = {
    enabled: body.enabled !== undefined ? !!body.enabled : cur.enabled,
    policy: (body.policy && typeof body.policy === 'object') ? body.policy : cur.policy,
  };
  await settingsService.saveSettings({ approvals: next });
  res.json({ success: true, data: next });
}));

/* ------------------------------- Queues ------------------------------- */

/** GET /api/approvals/pending — requests awaiting the signed-in user (admins see all). */
router.get('/pending', asyncHandler(async (req, res) => {
  if (isAdmin(req)) {
    return res.json({ success: true, data: await approvalService.listAllPending() });
  }
  const emp = await currentEmployee(req);
  res.json({ success: true, data: emp ? await approvalService.listPending(emp.id) : [] });
}));

/** GET /api/approvals/mine — requests the signed-in user has raised. */
router.get('/mine', asyncHandler(async (req, res) => {
  const emp = await currentEmployee(req);
  res.json({ success: true, data: emp ? await approvalService.listMine(emp.id) : [] });
}));

/** POST /api/approvals/:id/decide — approve or reject. */
router.post('/:id/decide', asyncHandler(async (req, res) => {
  const emp = await currentEmployee(req);
  const { decision, note } = req.body || {};
  const data = await approvalService.decide(req.params.id, {
    decision,
    note,
    deciderName: (emp && emp.fullName) || (req.user && req.user.email) || 'Unknown',
    deciderEmployeeId: emp && emp.id,
    isAdmin: isAdmin(req),
  });
  res.json({ success: true, data });
}));

module.exports = router;
