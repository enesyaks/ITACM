'use strict';

/**
 * ITIL Change Enablement. A change (CHG-) moves through an approval + scheduling
 * workflow. Standard changes are pre-authorized (draft → scheduled directly);
 * normal/emergency need a CAB decision (approve/reject) before scheduling.
 */
const { query } = require('./pool');
const { isUuid } = require('./rowMapper');
const { HttpError } = require('../../utils/httpError');

const TYPES = new Set(['standard', 'normal', 'emergency']);
const RISKS = new Set(['low', 'medium', 'high']);
const STATUSES = new Set(['draft', 'pending_approval', 'approved', 'rejected', 'scheduled', 'implementing', 'completed', 'failed', 'closed', 'cancelled']);
const TRANSITIONS = Object.freeze({
  draft: ['pending_approval', 'scheduled', 'cancelled'], // scheduled only for standard (checked below)
  pending_approval: ['approved', 'rejected', 'cancelled'],
  approved: ['scheduled', 'cancelled'],
  rejected: ['draft', 'cancelled'],
  scheduled: ['implementing', 'cancelled'],
  implementing: ['completed', 'failed'],
  completed: ['closed'],
  failed: ['closed', 'scheduled'],
  closed: [],
  cancelled: [],
});

function actor(user) {
  return { id: user && user.uid ? user.uid : null, name: (user && (user.username || user.email)) || 'system' };
}

const SELECT_COLS = `
  c.id, c.number, c.title, c.description, c.type, c.status, c.risk,
  c.implementation_plan AS "implementationPlan", c.rollback_plan AS "rollbackPlan",
  c.assignee_user_id AS "assigneeUserId", au.username AS "assigneeName",
  c.requested_by_name AS "requestedByName",
  c.approver_name AS "approverName", c.approval_note AS "approvalNote", c.approved_at AS "approvedAt",
  c.scheduled_start AS "scheduledStart", c.scheduled_end AS "scheduledEnd",
  c.completed_at AS "completedAt", c.closed_at AS "closedAt",
  c.created_at AS "createdAt", c.updated_at AS "updatedAt"`;

async function nextNumber() {
  const { rows } = await query("SELECT nextval('change_seq') AS n");
  return `CHG-${rows[0].n}`;
}

async function createChange(body, user) {
  const title = String((body && body.title) || '').trim().slice(0, 300);
  if (!title) throw HttpError.badRequest('A title is required');
  const description = String((body && body.description) || '').trim().slice(0, 8000);
  const type = TYPES.has(body && body.type) ? body.type : 'normal';
  const risk = RISKS.has(body && body.risk) ? body.risk : 'medium';
  const a = actor(user);
  const number = await nextNumber();
  const { rows } = await query(
    `INSERT INTO changes (number, title, description, type, risk, requested_by, requested_by_name, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'draft') RETURNING id`,
    [number, title, description || null, type, risk, a.id, a.name]
  );
  return getChange(rows[0].id);
}

async function getChange(id) {
  if (!isUuid(id)) throw HttpError.notFound('Change not found');
  const { rows } = await query(
    `SELECT ${SELECT_COLS} FROM changes c LEFT JOIN users au ON c.assignee_user_id = au.id WHERE c.id = $1`,
    [id]
  );
  if (!rows[0]) throw HttpError.notFound('Change not found');
  return rows[0];
}

async function listChanges(opts = {}) {
  const where = [];
  const params = [];
  if (opts.status && STATUSES.has(opts.status)) { params.push(opts.status); where.push(`c.status = $${params.length}`); }
  if (opts.type && TYPES.has(opts.type)) { params.push(opts.type); where.push(`c.type = $${params.length}`); }
  if (opts.open === true) where.push("c.status NOT IN ('completed', 'closed', 'cancelled', 'rejected')");
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const limit = Math.min(Math.max(Number(opts.limit) || 200, 1), 500);
  params.push(limit);
  const { rows } = await query(
    `SELECT ${SELECT_COLS} FROM changes c LEFT JOIN users au ON c.assignee_user_id = au.id
     ${whereSql} ORDER BY c.created_at DESC LIMIT $${params.length}`,
    params
  );
  return rows;
}

async function updateChange(id, patch, user) {
  if (!isUuid(id)) throw HttpError.notFound('Change not found');
  const { rows } = await query('SELECT * FROM changes WHERE id = $1', [id]);
  const cur = rows[0];
  if (!cur) throw HttpError.notFound('Change not found');

  const sets = [];
  const vals = [];
  const set = (col, val) => { vals.push(val); sets.push(`${col} = $${vals.length}`); };
  const text = (v, max) => (v ? String(v).trim().slice(0, max) : null);

  if (patch.title !== undefined) { const tt = text(patch.title, 300); if (!tt) throw HttpError.badRequest('A title is required'); set('title', tt); }
  if (patch.description !== undefined) set('description', text(patch.description, 8000));
  if (patch.implementationPlan !== undefined) set('implementation_plan', text(patch.implementationPlan, 8000));
  if (patch.rollbackPlan !== undefined) set('rollback_plan', text(patch.rollbackPlan, 8000));
  if (patch.type !== undefined) { if (!TYPES.has(patch.type)) throw HttpError.badRequest('Invalid type'); set('type', patch.type); }
  if (patch.risk !== undefined) { if (!RISKS.has(patch.risk)) throw HttpError.badRequest('Invalid risk'); set('risk', patch.risk); }
  if (patch.assigneeUserId !== undefined) {
    const next = patch.assigneeUserId || null;
    if (next && !isUuid(next)) throw HttpError.badRequest('Invalid assigneeUserId');
    set('assignee_user_id', next);
  }
  if (patch.scheduledStart !== undefined) set('scheduled_start', patch.scheduledStart ? new Date(patch.scheduledStart) : null);
  if (patch.scheduledEnd !== undefined) set('scheduled_end', patch.scheduledEnd ? new Date(patch.scheduledEnd) : null);

  if (patch.status !== undefined && patch.status !== cur.status) {
    if (!STATUSES.has(patch.status)) throw HttpError.badRequest('Invalid status');
    const allowed = TRANSITIONS[cur.status] || [];
    if (!allowed.includes(patch.status)) throw HttpError.badRequest(`Cannot move a change from "${cur.status}" to "${patch.status}"`);
    // Only standard (pre-authorized) changes may skip approval and schedule from draft.
    if (patch.status === 'scheduled' && cur.status === 'draft' && cur.type !== 'standard') {
      throw HttpError.badRequest('Only standard changes can be scheduled without approval');
    }
    // Approval decisions go through approveChange(), not a plain status write.
    if (patch.status === 'approved' || patch.status === 'rejected') {
      throw HttpError.badRequest('Use the approve/reject action for approval decisions');
    }
    set('status', patch.status);
    if (patch.status === 'completed') set('completed_at', new Date());
    else if (patch.status === 'closed') set('closed_at', new Date());
  }

  if (!sets.length) return getChange(id);
  set('updated_at', new Date());
  vals.push(id);
  await query(`UPDATE changes SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals);
  return getChange(id);
}

/** CAB decision — approve or reject a change that is pending approval. */
async function decideChange(id, { decision, note }, user) {
  if (!isUuid(id)) throw HttpError.notFound('Change not found');
  if (decision !== 'approve' && decision !== 'reject') throw HttpError.badRequest('decision must be approve or reject');
  const { rows } = await query('SELECT status FROM changes WHERE id = $1', [id]);
  if (!rows[0]) throw HttpError.notFound('Change not found');
  if (rows[0].status !== 'pending_approval') throw HttpError.badRequest('Only a change pending approval can be approved or rejected');
  const a = actor(user);
  const status = decision === 'approve' ? 'approved' : 'rejected';
  await query(
    `UPDATE changes SET status = $1, approver_user_id = $2, approver_name = $3, approval_note = $4,
        approved_at = now(), updated_at = now() WHERE id = $5`,
    [status, a.id, a.name, note ? String(note).trim().slice(0, 4000) : null, id]
  );
  return getChange(id);
}

module.exports = { createChange, getChange, listChanges, updateChange, decideChange, STATUSES };
