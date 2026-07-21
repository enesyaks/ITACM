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
};

/** Read the (normalized) approval config from settings. */
async function getConfig() {
  const s = await settingsService.getSettings().catch(() => ({}));
  const raw = s.approvals || {};
  return {
    enabled: !!raw.enabled,
    policy: (raw.policy && typeof raw.policy === 'object') ? raw.policy : DEFAULT_POLICY,
  };
}

async function isEnabled() {
  return (await getConfig()).enabled;
}

function levelsFor(config, type) {
  const lv = config.policy[type];
  return Array.isArray(lv) && lv.length ? lv : null;
}

/**
 * Open an approval request for an action, if policy requires one.
 * @returns {Promise<{required:false} | {required:true, request:object}>}
 */
async function createRequest({ type, requesterEmployeeId, requesterName, payload = {}, resourceRef = null, summary = null }) {
  const config = await getConfig();
  if (!config.enabled) return { required: false };
  const levels = levelsFor(config, type);
  if (!levels) return { required: false };
  if (!isUuid(requesterEmployeeId)) return { required: false }; // no requester → cannot route

  const approver = await orgService.resolveApprover(requesterEmployeeId, levels[0]);
  if (!approver) return { required: false }; // org not configured → don't block

  const { rows } = await query(
    `INSERT INTO approval_requests
       (type, requester_employee_id, requester_name, approver_employee_id, approver_name,
        levels, current_level, payload, resource_ref, summary)
     VALUES ($1,$2,$3,$4,$5,$6,0,$7,$8,$9)
     RETURNING *`,
    [type, requesterEmployeeId, requesterName || null, approver.id, approver.fullName,
      JSON.stringify(levels), JSON.stringify(payload), resourceRef,
      summary || TYPE_LABELS[type] || type]
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
     WHERE status = 'pending' AND approver_employee_id = $1
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

/**
 * Decide a pending request. On the final approval level the underlying action is
 * replayed via dispatch(). Multi-level policies advance to the next approver.
 */
async function decide(id, { decision, note = '', deciderName = '', deciderEmployeeId = null, isAdmin = false }) {
  const req = await getRequest(id);
  if (req.status !== 'pending') throw HttpError.badRequest('This request has already been decided');
  // Only the assigned approver (or an admin override) may decide. A non-admin
  // caller MUST resolve to an employee that matches the request's approver — a
  // null deciderEmployeeId (no linked employee record) is never authorized.
  if (!isAdmin && (!deciderEmployeeId || deciderEmployeeId !== req.approverEmployeeId)) {
    throw HttpError.forbidden('You are not the approver for this request');
  }

  if (decision === 'rejected') {
    await query(
      `UPDATE approval_requests
         SET status='rejected', decided_by=$2, decided_at=now(), decision_note=$3
       WHERE id=$1`, [id, deciderName || null, String(note || '').slice(0, 1000)]
    );
    return getRequest(id);
  }
  if (decision !== 'approved') throw HttpError.badRequest("decision must be 'approved' or 'rejected'");

  const levels = Array.isArray(req.levels) ? req.levels : [];
  const nextLevel = req.currentLevel + 1;
  if (nextLevel < levels.length) {
    // Advance to the next approver in the chain.
    const nextApprover = await orgService.resolveApprover(req.requesterEmployeeId, levels[nextLevel]);
    if (nextApprover) {
      await query(
        `UPDATE approval_requests
           SET current_level=$2, approver_employee_id=$3, approver_name=$4
         WHERE id=$1`, [id, nextLevel, nextApprover.id, nextApprover.fullName]
      );
      const advanced = await getRequest(id);
      notify(advanced).catch(() => {});
      return advanced;
    }
    // No next approver resolvable → treat this approval as final.
  }

  // Final approval: replay the action, then mark approved.
  await dispatch(req, { deciderName });
  await query(
    `UPDATE approval_requests
       SET status='approved', decided_by=$2, decided_at=now(), decision_note=$3
     WHERE id=$1`, [id, deciderName || null, String(note || '').slice(0, 1000)]
  );
  return getRequest(id);
}

async function cancel(id) {
  const req = await getRequest(id);
  if (req.status !== 'pending') throw HttpError.badRequest('Only pending requests can be cancelled');
  await query(`UPDATE approval_requests SET status='cancelled', decided_at=now() WHERE id=$1`, [id]);
  return getRequest(id);
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
    default:
      return null;
  }
}

/** Fire-and-forget notification to the current approver (best-effort). */
async function notify(request) {
  try {
    const providers = require('./index');
    if (providers.notificationService && providers.notificationService.sendApprovalNotice) {
      await providers.notificationService.sendApprovalNotice(request);
    }
  } catch { /* notifications are best-effort */ }
}

module.exports = {
  DEFAULT_POLICY,
  getConfig,
  isEnabled,
  createRequest,
  getRequest,
  listPending,
  listMine,
  listAllPending,
  decide,
  cancel,
};
