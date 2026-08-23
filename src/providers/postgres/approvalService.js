/**
 * Generic approval workflow — SHIPS PASSIVE.
 *
 * Gated by app_settings.approvals.enabled (default false). While disabled,
 * createRequest() always returns { required: false } so every caller proceeds
 * exactly as before — no behaviour change until an admin flips the switch.
 *
 * Per-action depth is configured in app_settings.approvals.policy, e.g.
 *   { asset_sale: ['manager', 'department'], license_assign: ['manager'] }
 * Levels are resolved through orgService.resolveApprover(). If no approver can be
 * resolved (org chart not filled in), the request is NOT created and the action
 * proceeds — a half-configured hierarchy must never silently block real work.
 */
const { query } = require('./pool');
const { mapRow, mapRows, isUuid } = require('./rowMapper');
const { HttpError } = require('../../utils/httpError');
const orgService = require('./orgService');
const settingsService = require('./settingsService');

const DEFAULT_POLICY = {
  asset_sale: ['manager', 'department'],
  asset_scrap: ['manager', 'department'],
  license_assign: ['manager'],
};

const TYPE_LABELS = {
  asset_sale: 'Asset sale',
  asset_scrap: 'Asset scrap',
  license_assign: 'Software / license assignment',
  ticket_request: 'Service request',
};

/** Read the (normalized) approval config from settings. */
async function getConfig() {
  const s = await settingsService.getSettings().catch(() => ({}));
  const raw = s.approvals || {};
  const clampDays = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.min(Number(v), 90) : 0);
  return {
    enabled: !!raw.enabled,
    policy: (raw.policy && typeof raw.policy === 'object') ? raw.policy : DEFAULT_POLICY,
    // Days a request may sit pending before the approver is re-notified. 0 = off.
    reminderDays: clampDays(raw.reminderDays),
    // Days a request may sit pending before its step escalates up to the
    // approver's manager. 0 = off.
    escalateDays: clampDays(raw.escalateDays),
  };
}

async function isEnabled() {
  return (await getConfig()).enabled;
}

function levelsFor(config, type) {
  const lv = config.policy[type];
  return Array.isArray(lv) && lv.length ? lv : null;
}

/* --------------------------- steps (seq + parallel) --------------------------- */
// A `levels` element is either a level string ('manager' or 'emp:<uuid>') →
// single-approver step, or an object { levels:[...], mode:'any'|'all' } → parallel.
function normalizeStep(element) {
  if (element && typeof element === 'object' && Array.isArray(element.levels)) {
    return { orgLevels: element.levels.map(String), mode: element.mode === 'all' ? 'all' : 'any' };
  }
  return { orgLevels: [String(element)], mode: 'any' };
}

/**
 * If `approver` has an active out-of-office delegate (set, active employee, and
 * not past approval_delegate_until), return the delegate instead — a single hop,
 * and never the requester (that would allow self-approval). Otherwise unchanged.
 */
async function applyDelegate(approver, requesterEmployeeId) {
  if (!approver || !approver.id) return approver;
  const { rows } = await query(
    `SELECT d.id, d.full_name FROM employees e
       JOIN employees d ON d.id = e.approval_delegate_id
      WHERE e.id = $1 AND d.status = 'Active'
        AND (e.approval_delegate_until IS NULL OR e.approval_delegate_until >= CURRENT_DATE)`,
    [approver.id]
  );
  const del = rows[0];
  if (del && del.id !== approver.id && del.id !== requesterEmployeeId) {
    return { id: del.id, fullName: del.full_name };
  }
  return approver;
}

/**
 * Resolve a single level token to one approver (delegate-substituted).
 *  - 'emp:<uuid>' → that specific active employee (fixed approver, e.g. finance).
 *  - any other string → walked through the org chart by orgService.resolveApprover.
 * A fixed approver that resolves to the requester is dropped (no self-approval).
 */
async function resolveLevel(requesterEmployeeId, lvl) {
  const s = String(lvl);
  let base = null;
  if (s.startsWith('emp:')) {
    const id = s.slice(4);
    if (!isUuid(id) || id === requesterEmployeeId) return null;
    const r = await query("SELECT id, full_name FROM employees WHERE id = $1 AND status = 'Active'", [id]);
    base = r.rows[0] ? { id: r.rows[0].id, fullName: r.rows[0].full_name } : null;
  } else {
    base = await orgService.resolveApprover(requesterEmployeeId, s);
  }
  return applyDelegate(base, requesterEmployeeId);
}

/** Resolve a step's levels to distinct approvers (order preserved, deduped). */
async function resolveStepApprovers(requesterEmployeeId, element) {
  const step = normalizeStep(element);
  const out = [];
  const seen = new Set();
  for (const lvl of step.orgLevels) {
    const a = await resolveLevel(requesterEmployeeId, lvl);
    if (a && !seen.has(a.id)) { seen.add(a.id); out.push(a); }
  }
  return { approvers: out, mode: step.mode };
}

/**
 * Point an existing request at step `index`: a single approver goes to
 * approver_employee_id (step_state cleared), multiple to step_state/step_mode.
 * Returns false when the step can't be resolved (advance should finalize).
 */
async function setupStep(requestId, requesterEmployeeId, levels, index) {
  if (index >= levels.length) return false;
  const { approvers, mode } = await resolveStepApprovers(requesterEmployeeId, levels[index]);
  if (!approvers.length) return false;
  if (approvers.length === 1) {
    await query(
      `UPDATE approval_requests SET current_level=$2, approver_employee_id=$3, approver_name=$4, step_state=NULL, step_mode=NULL WHERE id=$1`,
      [requestId, index, approvers[0].id, approvers[0].fullName]
    );
  } else {
    const state = approvers.map((a) => ({ employeeId: a.id, name: a.fullName, status: 'pending' }));
    await query(
      `UPDATE approval_requests SET current_level=$2, approver_employee_id=NULL, approver_name=NULL, step_state=$3::jsonb, step_mode=$4 WHERE id=$1`,
      [requestId, index, JSON.stringify(state), mode]
    );
  }
  return true;
}

/** Preview who a chain would route to for one requester (no side effects). */
async function previewChain(requesterEmployeeId, levels) {
  if (!isUuid(requesterEmployeeId) || !Array.isArray(levels)) return [];
  const out = [];
  for (const el of levels) {
    const { approvers, mode } = await resolveStepApprovers(requesterEmployeeId, el);
    out.push({ approvers: approvers.map((a) => a.fullName), mode });
  }
  return out;
}

/**
 * Open an approval request for an action, if policy requires one.
 * @returns {Promise<{required:false} | {required:true, request:object}>}
 */
async function createRequest({ type, requesterEmployeeId, requesterName, payload = {}, resourceRef = null, summary = null, levels: explicitLevels = null }) {
  const config = await getConfig();
  if (!config.enabled) return { required: false };
  const levels = (Array.isArray(explicitLevels) && explicitLevels.length) ? explicitLevels : levelsFor(config, type);
  if (!levels) return { required: false };
  if (!isUuid(requesterEmployeeId)) return { required: false }; // no requester → cannot route

  // Resolve step 0 (single or parallel). If the org chart yields no approver, skip.
  const step0 = await resolveStepApprovers(requesterEmployeeId, levels[0]);
  if (!step0.approvers.length) return { required: false };
  const single = step0.approvers.length === 1 ? step0.approvers[0] : null;
  const stepState = single ? null : JSON.stringify(step0.approvers.map((a) => ({ employeeId: a.id, name: a.fullName, status: 'pending' })));

  const { rows } = await query(
    `INSERT INTO approval_requests
       (type, requester_employee_id, requester_name, approver_employee_id, approver_name,
        levels, current_level, payload, resource_ref, summary, step_state, step_mode)
     VALUES ($1,$2,$3,$4,$5,$6,0,$7,$8,$9,$10::jsonb,$11)
     RETURNING *`,
    [type, requesterEmployeeId, requesterName || null, single ? single.id : null, single ? single.fullName : null,
      JSON.stringify(levels), JSON.stringify(payload), resourceRef,
      summary || TYPE_LABELS[type] || type, stepState, single ? null : step0.mode]
  );
  const request = mapRow(rows[0]);
  notify(request).catch(() => {});
  return { required: true, request };
}

async function getRequest(id) {
  if (!isUuid(id)) throw HttpError.notFound('Approval request not found');
  const { rows } = await query('SELECT * FROM approval_requests WHERE id = $1', [id]);
  if (!rows[0]) throw HttpError.notFound('Approval request not found');
  return mapRow(rows[0]);
}

async function listPending(approverEmployeeId) {
  if (!isUuid(approverEmployeeId)) return [];
  const { rows } = await query(
    `SELECT * FROM approval_requests
     WHERE status = 'pending' AND (
       approver_employee_id = $1::uuid
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(step_state, '[]'::jsonb)) e
                  WHERE e->>'employeeId' = $1::text AND e->>'status' = 'pending')
     )
     ORDER BY created_at DESC`, [approverEmployeeId]
  );
  return mapRows(rows);
}

async function listMine(requesterEmployeeId, { limit = 50 } = {}) {
  if (!isUuid(requesterEmployeeId)) return [];
  const { rows } = await query(
    `SELECT * FROM approval_requests
     WHERE requester_employee_id = $1
     ORDER BY created_at DESC LIMIT $2`, [requesterEmployeeId, Math.min(Number(limit) || 50, 500)]
  );
  return mapRows(rows);
}

/** Admin view: every pending request regardless of approver. */
async function listAllPending() {
  const { rows } = await query(
    `SELECT * FROM approval_requests WHERE status = 'pending' ORDER BY created_at DESC`
  );
  return mapRows(rows);
}

/** Append one decision to the request's audit trail (best-effort, never throws). */
async function appendHistory(id, entry) {
  const row = { at: new Date().toISOString(), ...entry };
  await query('UPDATE approval_requests SET history = COALESCE(history, \'[]\'::jsonb) || $2::jsonb WHERE id=$1',
    [id, JSON.stringify([row])]).catch(() => {});
}

/**
 * Decide a pending request. On the final approval level the underlying action is
 * replayed via dispatch(). Multi-level policies advance to the next approver.
 * Every individual approve/reject is appended to history for the audit trail.
 */
async function decide(id, { decision, note = '', deciderName = '', deciderEmployeeId = null, isAdmin = false }) {
  const req = await getRequest(id);
  if (req.status !== 'pending') throw HttpError.badRequest('This request has already been decided');
  // The current step is either single (approver_employee_id) or parallel (step_state).
  const parallel = Array.isArray(req.stepState) && req.stepState.length > 0;
  const myEntry = parallel ? req.stepState.find((e) => e.employeeId === deciderEmployeeId && e.status === 'pending') : null;
  if (!isAdmin) {
    const authorized = parallel ? !!myEntry : (deciderEmployeeId && deciderEmployeeId === req.approverEmployeeId);
    if (!authorized) throw HttpError.forbidden('You are not the approver for this request');
  }

  if (decision === 'rejected') {
    const rejSlot = parallel ? (myEntry || req.stepState.find((e) => e.status === 'pending')) : null;
    await appendHistory(id, { level: req.currentLevel, decision: 'rejected', deciderName: deciderName || null, deciderEmployeeId: deciderEmployeeId || null, approverName: (rejSlot ? rejSlot.name : req.approverName) || null, note: String(note || '').slice(0, 1000) || null });
    // Any single rejection rejects the whole request (both step modes).
    await query(
      `UPDATE approval_requests SET status='rejected', decided_by=$2, decided_at=now(), decision_note=$3 WHERE id=$1`,
      [id, deciderName || null, String(note || '').slice(0, 1000)]
    );
    await dispatchReject(req, { deciderName });
    notifyRequesterDecision(req, 'rejected', deciderName).catch(() => {});
    return getRequest(id);
  }
  if (decision !== 'approved') throw HttpError.badRequest("decision must be 'approved' or 'rejected'");

  if (parallel) {
    const target = myEntry || req.stepState.find((e) => e.status === 'pending'); // admin approves the first pending
    await appendHistory(id, { level: req.currentLevel, decision: 'approved', deciderName: deciderName || null, deciderEmployeeId: deciderEmployeeId || null, approverName: (target ? target.name : null), note: String(note || '').slice(0, 1000) || null });
    const newState = req.stepState.map((e) => (target && e.employeeId === target.employeeId ? { ...e, status: 'approved' } : e));
    const stepDone = req.stepMode === 'all' ? newState.every((e) => e.status === 'approved') : newState.some((e) => e.status === 'approved');
    if (!stepDone) {
      await query(`UPDATE approval_requests SET step_state=$2::jsonb WHERE id=$1`, [id, JSON.stringify(newState)]);
      return getRequest(id); // still waiting on the other approver(s) at this step
    }
    // step complete → advance below
  } else {
    await appendHistory(id, { level: req.currentLevel, decision: 'approved', deciderName: deciderName || null, deciderEmployeeId: deciderEmployeeId || null, approverName: req.approverName || null, note: String(note || '').slice(0, 1000) || null });
  }
  return advance(await getRequest(id), { note, deciderName });
}

/** Move a request to its next step, or finalize (dispatch + approved) if none. */
async function advance(req, { note = '', deciderName = '' } = {}) {
  const levels = Array.isArray(req.levels) ? req.levels : [];
  const nextIndex = req.currentLevel + 1;
  if (nextIndex < levels.length) {
    const ok = await setupStep(req.id, req.requesterEmployeeId, levels, nextIndex);
    if (ok) {
      const advanced = await getRequest(req.id);
      notify(advanced).catch(() => {});
      return advanced;
    }
    // next step unresolvable → finalize as if this were the last step
  }
  await dispatch(req, { deciderName });
  await query(
    `UPDATE approval_requests SET status='approved', decided_by=$2, decided_at=now(), decision_note=$3, step_state=NULL WHERE id=$1`,
    [req.id, deciderName || null, String(note || '').slice(0, 1000)]
  );
  notifyRequesterDecision(req, 'approved', deciderName).catch(() => {});
  return getRequest(req.id);
}

async function cancel(id) {
  const req = await getRequest(id);
  if (req.status !== 'pending') throw HttpError.badRequest('Only pending requests can be cancelled');
  await query(`UPDATE approval_requests SET status='cancelled', decided_at=now() WHERE id=$1`, [id]);
  return getRequest(id);
}

/**
 * Withdraw a pending request. Only the requester (or an admin) may do this, and
 * only while pending. For a service request the held ticket is cancelled.
 */
async function cancelByRequester(id, { requesterEmployeeId, isAdmin = false } = {}) {
  const req = await getRequest(id);
  if (req.status !== 'pending') throw HttpError.badRequest('Only a pending request can be withdrawn');
  if (!isAdmin && req.requesterEmployeeId !== requesterEmployeeId) {
    throw HttpError.forbidden('You can only withdraw your own requests');
  }
  await query(`UPDATE approval_requests SET status='cancelled', decided_at=now() WHERE id=$1`, [id]);
  await dispatchWithdraw(req);
  return getRequest(id);
}

/** Cancel the held ticket when a service request is withdrawn. Best-effort. */
async function dispatchWithdraw(req) {
  try {
    const providers = require('./index');
    if (req.type === 'ticket_request' && providers.ticketService && providers.ticketService.onRequestWithdrawn) {
      await providers.ticketService.onRequestWithdrawn(req.payload || {}, { name: req.requesterName || 'Requester' });
    }
  } catch { /* withdrawal side-effects are best-effort */ }
}

/**
 * Re-notify approvers of requests that have sat pending past reminderDays. Called
 * by the scheduler. Each nudge stamps last_reminded_at so the next only fires
 * after another full interval. Returns how many reminders were sent.
 */
async function sweepReminders() {
  const config = await getConfig();
  if (!config.enabled || !config.reminderDays) return 0;
  const { rows } = await query(
    `SELECT * FROM approval_requests
      WHERE status = 'pending'
        AND now() - COALESCE(last_reminded_at, created_at) >= ($1 || ' days')::interval`,
    [String(config.reminderDays)]
  );
  let sent = 0;
  for (const row of rows) {
    const request = mapRow(row);
    await query('UPDATE approval_requests SET last_reminded_at = now() WHERE id = $1', [request.id]);
    try {
      const providers = require('./index');
      if (providers.notificationService && providers.notificationService.sendApprovalNotice) {
        await providers.notificationService.sendApprovalNotice(request, { reminder: true });
        sent += 1;
      }
    } catch { /* reminders are best-effort */ }
  }
  return sent;
}

/**
 * Escalate single-approver steps left pending past escalateDays up to the current
 * approver's manager (never auto-approves). Records an 'escalated' history entry,
 * stamps escalated_at, and notifies the new approver. Returns how many escalated.
 * Parallel steps are skipped (ambiguous which approver to escalate).
 */
async function sweepEscalations() {
  const config = await getConfig();
  if (!config.enabled || !config.escalateDays) return 0;
  const { rows } = await query(
    `SELECT * FROM approval_requests
      WHERE status = 'pending' AND approver_employee_id IS NOT NULL AND step_state IS NULL
        AND now() - COALESCE(escalated_at, created_at) >= ($1 || ' days')::interval`,
    [String(config.escalateDays)]
  );
  let escalated = 0;
  for (const row of rows) {
    const request = mapRow(row);
    const mgr = await orgService.resolveApprover(request.approverEmployeeId, 'manager').catch(() => null);
    // Nothing to escalate to, or it would loop back to the approver / requester.
    if (!mgr || mgr.id === request.approverEmployeeId || mgr.id === request.requesterEmployeeId) {
      await query('UPDATE approval_requests SET escalated_at = now() WHERE id = $1', [request.id]);
      continue;
    }
    await appendHistory(request.id, {
      level: request.currentLevel, decision: 'escalated',
      deciderName: null, deciderEmployeeId: null,
      approverName: `${request.approverName || '—'} → ${mgr.fullName}`,
      note: 'Auto-escalated — no response in time',
    });
    await query(
      'UPDATE approval_requests SET approver_employee_id = $2, approver_name = $3, escalated_at = now() WHERE id = $1',
      [request.id, mgr.id, mgr.fullName]
    );
    notify(await getRequest(request.id)).catch(() => {});
    escalated += 1;
  }
  return escalated;
}

/**
 * Replay an approved action against the underlying service. Lazy-require the
 * services to avoid circular dependencies at module load. Each handler receives
 * the stored payload; it must perform the same operation the trigger deferred.
 */
async function dispatch(req, { deciderName }) {
  const providers = require('./index');
  const p = req.payload || {};
  const actor = { name: deciderName || 'Approval', viaApproval: req.id };
  switch (req.type) {
    case 'license_assign':
      if (providers.licenseService && providers.licenseService.replayApproved) {
        return providers.licenseService.replayApproved(p, actor);
      }
      return null;
    case 'asset_sale':
    case 'asset_scrap':
      if (providers.offboardService && providers.offboardService.replayApproved) {
        return providers.offboardService.replayApproved(req.type, p, actor);
      }
      return null;
    case 'ticket_request':
      if (providers.ticketService && providers.ticketService.onRequestApproved) {
        return providers.ticketService.onRequestApproved(p, actor);
      }
      return null;
    default:
      return null;
  }
}

/** React to a rejected request. Only ticket requests currently need this (the
 * asset/license flows simply don't replay). Best-effort, never throws upward. */
async function dispatchReject(req, { deciderName }) {
  try {
    const providers = require('./index');
    if (req.type === 'ticket_request' && providers.ticketService && providers.ticketService.onRequestRejected) {
      await providers.ticketService.onRequestRejected(req.payload || {}, { name: deciderName });
    }
  } catch { /* rejection side-effects are best-effort */ }
}

/** Fire-and-forget notification to the current approver — email + in-app. */
async function notify(request) {
  const providers = require('./index');
  try {
    if (providers.notificationService && providers.notificationService.sendApprovalNotice) {
      await providers.notificationService.sendApprovalNotice(request);
    }
  } catch { /* email is best-effort */ }
  try {
    if (providers.inappService && request) {
      // Current approver(s): the single approver, or each pending parallel one.
      const ids = [];
      if (request.approverEmployeeId) ids.push(request.approverEmployeeId);
      if (Array.isArray(request.stepState)) for (const e of request.stepState) if (e && e.status === 'pending' && e.employeeId) ids.push(e.employeeId);
      for (const empId of [...new Set(ids)]) {
        await providers.inappService.createForEmployee(empId, {
          type: 'approval_request',
          title: request.summary || 'Approval needed',
          body: `${request.requesterName || 'A requester'} needs your approval.`,
          link: '#/approvals',
        });
      }
    }
  } catch { /* in-app is best-effort */ }
}

/** Notify the requester in-app that their request was decided (best-effort). */
async function notifyRequesterDecision(request, decision, deciderName) {
  try {
    const providers = require('./index');
    if (providers.inappService && request && request.requesterEmployeeId) {
      await providers.inappService.createForEmployee(request.requesterEmployeeId, {
        type: 'approval_' + decision,
        title: `${request.summary || 'Your request'} — ${decision === 'approved' ? 'approved' : 'rejected'}`,
        body: deciderName ? `Decided by ${deciderName}.` : null,
        link: request.type === 'ticket_request' ? '#/my-tickets' : '#/approvals',
      });
    }
  } catch { /* best-effort */ }
}

module.exports = {
  DEFAULT_POLICY,
  getConfig,
  isEnabled,
  createRequest,
  previewChain,
  getRequest,
  listPending,
  listMine,
  listAllPending,
  decide,
  cancel,
  cancelByRequester,
  sweepReminders,
  sweepEscalations,
};
