'use strict';

/**
 * ITIL Problem Management. A problem is a root-cause investigation that can group
 * several incidents (tickets.problem_id). With a documented root_cause +
 * workaround in the `known_error` status it serves as a Known Error record.
 */
const { query } = require('./pool');
const { isUuid } = require('./rowMapper');
const { HttpError } = require('../../utils/httpError');

const PRIORITIES = new Set(['low', 'medium', 'high', 'urgent']);
const STATUSES = new Set(['new', 'investigating', 'known_error', 'resolved', 'closed']);
const TRANSITIONS = Object.freeze({
  new: ['investigating', 'closed'],
  investigating: ['known_error', 'resolved', 'closed'],
  known_error: ['investigating', 'resolved', 'closed'],
  resolved: ['closed', 'investigating'],
  closed: ['investigating'],
});

function actor(user) {
  return {
    id: user && user.uid ? user.uid : null,
    name: (user && (user.username || user.email)) || 'system',
  };
}

const SELECT_COLS = `
  p.id, p.number, p.title, p.description, p.status, p.priority,
  p.root_cause AS "rootCause", p.workaround,
  p.assignee_user_id AS "assigneeUserId", au.username AS "assigneeName",
  p.created_by_name AS "createdByName",
  p.resolved_at AS "resolvedAt", p.closed_at AS "closedAt",
  p.created_at AS "createdAt", p.updated_at AS "updatedAt",
  (SELECT COUNT(*) FROM tickets t WHERE t.problem_id = p.id)::int AS "incidentCount"`;

async function nextNumber() {
  const { rows } = await query("SELECT nextval('problem_seq') AS n");
  return `PRB-${rows[0].n}`;
}

async function createProblem(body, user) {
  const title = String((body && body.title) || '').trim().slice(0, 300);
  if (!title) throw HttpError.badRequest('A title is required');
  const description = String((body && body.description) || '').trim().slice(0, 8000);
  const priority = PRIORITIES.has(body && body.priority) ? body.priority : 'medium';
  const a = actor(user);
  const number = await nextNumber();
  const { rows } = await query(
    `INSERT INTO problems (number, title, description, priority, created_by, created_by_name, status)
     VALUES ($1,$2,$3,$4,$5,$6,'new') RETURNING id`,
    [number, title, description || null, priority, a.id, a.name]
  );
  return getProblem(rows[0].id);
}

async function getProblem(id) {
  if (!isUuid(id)) throw HttpError.notFound('Problem not found');
  const { rows } = await query(
    `SELECT ${SELECT_COLS} FROM problems p LEFT JOIN users au ON p.assignee_user_id = au.id WHERE p.id = $1`,
    [id]
  );
  const problem = rows[0];
  if (!problem) throw HttpError.notFound('Problem not found');
  const { rows: incidents } = await query(
    `SELECT id, number, subject, status, priority FROM tickets WHERE problem_id = $1 ORDER BY created_at DESC`,
    [id]
  );
  problem.incidents = incidents;
  return problem;
}

async function listProblems(opts = {}) {
  const where = [];
  const params = [];
  if (opts.status && STATUSES.has(opts.status)) { params.push(opts.status); where.push(`p.status = $${params.length}`); }
  if (opts.open === true) where.push("p.status <> 'closed'");
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const limit = Math.min(Math.max(Number(opts.limit) || 200, 1), 500);
  params.push(limit);
  const { rows } = await query(
    `SELECT ${SELECT_COLS} FROM problems p LEFT JOIN users au ON p.assignee_user_id = au.id
     ${whereSql} ORDER BY p.created_at DESC LIMIT $${params.length}`,
    params
  );
  return rows;
}

async function updateProblem(id, patch, user) {
  if (!isUuid(id)) throw HttpError.notFound('Problem not found');
  const { rows } = await query('SELECT * FROM problems WHERE id = $1', [id]);
  const cur = rows[0];
  if (!cur) throw HttpError.notFound('Problem not found');

  const sets = [];
  const vals = [];
  const set = (col, val) => { vals.push(val); sets.push(`${col} = $${vals.length}`); };

  if (patch.title !== undefined) {
    const title = String(patch.title || '').trim().slice(0, 300);
    if (!title) throw HttpError.badRequest('A title is required');
    set('title', title);
  }
  if (patch.description !== undefined) set('description', patch.description ? String(patch.description).trim().slice(0, 8000) : null);
  if (patch.rootCause !== undefined) set('root_cause', patch.rootCause ? String(patch.rootCause).trim().slice(0, 8000) : null);
  if (patch.workaround !== undefined) set('workaround', patch.workaround ? String(patch.workaround).trim().slice(0, 8000) : null);
  if (patch.priority !== undefined) {
    if (!PRIORITIES.has(patch.priority)) throw HttpError.badRequest('Invalid priority');
    set('priority', patch.priority);
  }
  if (patch.assigneeUserId !== undefined) {
    const next = patch.assigneeUserId || null;
    if (next && !isUuid(next)) throw HttpError.badRequest('Invalid assigneeUserId');
    set('assignee_user_id', next);
  }
  if (patch.status !== undefined) {
    if (!STATUSES.has(patch.status)) throw HttpError.badRequest('Invalid status');
    if (patch.status !== cur.status) {
      const allowed = TRANSITIONS[cur.status] || [];
      if (!allowed.includes(patch.status)) {
        throw HttpError.badRequest(`Cannot move a problem from "${cur.status}" to "${patch.status}"`);
      }
      set('status', patch.status);
      if (patch.status === 'resolved') set('resolved_at', new Date());
      else if (patch.status === 'closed') set('closed_at', new Date());
      else if (patch.status === 'investigating') { set('resolved_at', null); set('closed_at', null); }
    }
  }
  if (!sets.length) return getProblem(id);
  set('updated_at', new Date());
  vals.push(id);
  await query(`UPDATE problems SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals);
  // Closing a problem cascades to its linked incidents: close them and cancel any
  // pending approval they hold. Best-effort — never block the problem update.
  if (patch.status === 'closed' && cur.status !== 'closed') {
    try {
      const providers = require('./index');
      if (providers.ticketService && providers.ticketService.closeForProblem) {
        await providers.ticketService.closeForProblem(id, (user && user.username) || 'System');
      }
    } catch { /* cascade is best-effort */ }
  }
  return getProblem(id);
}

/** Link / unlink an incident (ticket) to a problem. */
async function linkTicket(problemId, ticketId) {
  if (!isUuid(problemId) || !isUuid(ticketId)) throw HttpError.badRequest('Invalid id');
  const prob = await query('SELECT id FROM problems WHERE id = $1', [problemId]);
  if (!prob.rows[0]) throw HttpError.notFound('Problem not found');
  const { rowCount } = await query('UPDATE tickets SET problem_id = $1, updated_at = now() WHERE id = $2', [problemId, ticketId]);
  if (!rowCount) throw HttpError.notFound('Ticket not found');
  return getProblem(problemId);
}
async function unlinkTicket(problemId, ticketId) {
  if (!isUuid(problemId) || !isUuid(ticketId)) throw HttpError.badRequest('Invalid id');
  await query('UPDATE tickets SET problem_id = NULL, updated_at = now() WHERE id = $1 AND problem_id = $2', [ticketId, problemId]);
  return getProblem(problemId);
}

module.exports = { createProblem, getProblem, listProblems, updateProblem, linkTicket, unlinkTicket, STATUSES };
