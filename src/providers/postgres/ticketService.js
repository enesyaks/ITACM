'use strict';

/**
 * ITIL service desk — incidents + service requests (MVP).
 *
 * Staff (with the `ticket` permission) work every ticket; employees raise and
 * see only their own via the /api/me/tickets self-service path. The status
 * machine is enforced here (never trust the UI), and every change is written to
 * ticket_activity.
 */
const { query, withTransaction } = require('./pool');
const { isUuid } = require('./rowMapper');
const { HttpError } = require('../../utils/httpError');

const TYPES = new Set(['incident', 'request']);
const PRIORITIES = new Set(['low', 'medium', 'high', 'urgent']);
const STATUSES = new Set(['new', 'open', 'in_progress', 'pending', 'resolved', 'closed', 'cancelled']);
const TERMINAL = new Set(['resolved', 'closed', 'cancelled']);

// SLA targets (elapsed minutes from creation) by priority. First response and
// resolution each get their own clock; times are wall-clock (no business-hours
// calendar in the MVP). Editable defaults — a settings-driven override can layer
// on later without touching callers.
const SLA_TARGETS = Object.freeze({
  urgent: { responseMins: 30, resolveMins: 240 },   // 30m / 4h
  high: { responseMins: 60, resolveMins: 480 },     // 1h / 8h
  medium: { responseMins: 240, resolveMins: 1440 }, // 4h / 24h
  low: { responseMins: 480, resolveMins: 2880 },    // 8h / 48h
});

function targetsFor(priority) {
  return SLA_TARGETS[priority] || SLA_TARGETS.medium;
}
function addMinutes(from, mins) {
  return new Date(new Date(from).getTime() + mins * 60 * 1000);
}
function slaDueDates(priority, from) {
  const tgt = targetsFor(priority);
  return { responseDueAt: addMinutes(from, tgt.responseMins), resolveDueAt: addMinutes(from, tgt.resolveMins) };
}

// Live SLA state for one leg. `doneAt` is when that leg completed
// (first_response_at / resolved_at); once set it fixes met-vs-breached.
function legState(dueAt, doneAt, open) {
  if (!dueAt) return { state: 'none' };
  const due = new Date(dueAt).getTime();
  if (doneAt) return { state: new Date(doneAt).getTime() <= due ? 'met' : 'breached', dueAt };
  if (!open) return { state: 'na', dueAt }; // closed/cancelled without ever completing this leg
  const now = Date.now();
  return now > due ? { state: 'breached', dueAt } : { state: 'due', dueAt, remainingMs: due - now };
}

const SLA_RAW = ['responseDueAt', 'resolveDueAt', 'responseBreachedAt', 'resolveBreachedAt'];

// Attach a compact `sla` object for staff views; drop the raw columns either way.
function decorateSla(row) {
  const open = !TERMINAL.has(row.status);
  row.sla = {
    response: legState(row.responseDueAt, row.firstResponseAt, open),
    resolve: legState(row.resolveDueAt, row.resolvedAt, open),
  };
  for (const k of SLA_RAW) delete row[k];
  return row;
}
function stripSla(row) {
  for (const k of SLA_RAW) delete row[k];
  return row;
}

// Allowed status transitions (from → [to]). Missing / same-state = rejected.
const TRANSITIONS = Object.freeze({
  new: ['open', 'in_progress', 'cancelled'],
  open: ['in_progress', 'pending', 'resolved', 'cancelled'],
  in_progress: ['open', 'pending', 'resolved', 'cancelled'],
  pending: ['in_progress', 'resolved', 'cancelled'],
  resolved: ['closed', 'in_progress'],
  closed: ['in_progress'],
  cancelled: [],
});

function actor(user) {
  return {
    id: user && user.uid ? user.uid : null,
    name: (user && (user.username || user.email)) || 'system',
    email: (user && user.email) || null,
  };
}

async function nextNumber(type) {
  const seq = type === 'request' ? 'ticket_request_seq' : 'ticket_incident_seq';
  const prefix = type === 'request' ? 'REQ' : 'INC';
  const { rows } = await query(`SELECT nextval('${seq}') AS n`);
  return `${prefix}-${rows[0].n}`;
}

async function logActivity(ticketId, a, action, detail) {
  await query(
    'INSERT INTO ticket_activity (ticket_id, actor_name, action, detail) VALUES ($1, $2, $3, $4)',
    [ticketId, a.name, action, detail || null]
  );
}

const SELECT_COLS = `
  t.id, t.number, t.type, t.subject, t.description, t.status, t.priority, t.category,
  t.requester_employee_id AS "requesterEmployeeId", re.full_name AS "requesterName",
  t.assignee_user_id AS "assigneeUserId", au.username AS "assigneeName",
  t.asset_id AS "assetId", a.asset_tag AS "assetTag",
  t.created_by_name AS "createdByName",
  t.first_response_at AS "firstResponseAt", t.resolved_at AS "resolvedAt", t.closed_at AS "closedAt",
  t.response_due_at AS "responseDueAt", t.resolve_due_at AS "resolveDueAt",
  t.response_breached_at AS "responseBreachedAt", t.resolve_breached_at AS "resolveBreachedAt",
  t.created_at AS "createdAt", t.updated_at AS "updatedAt"`;
const FROM_JOINS = `
  FROM tickets t
  LEFT JOIN employees re ON t.requester_employee_id = re.id
  LEFT JOIN users au     ON t.assignee_user_id = au.id
  LEFT JOIN assets a     ON t.asset_id = a.id`;

/** Resolve the employee row that owns a self-service (Portal) session, by email. */
async function employeeForUser(user) {
  const email = String((user && user.email) || '').trim().toLowerCase();
  if (!email) return null;
  const { rows } = await query('SELECT id, full_name FROM employees WHERE lower(email) = $1 LIMIT 1', [email]);
  return rows[0] || null;
}

async function createTicket(body, user, { asEmployee = null } = {}) {
  const type = TYPES.has(body && body.type) ? body.type : 'incident';
  const subject = String((body && body.subject) || '').trim().slice(0, 300);
  if (!subject) throw HttpError.badRequest('A subject is required');
  const description = String((body && body.description) || '').trim().slice(0, 8000);
  const priority = PRIORITIES.has(body && body.priority) ? body.priority : 'medium';
  const category = body && body.category ? String(body.category).trim().slice(0, 120) : null;
  const a = actor(user);

  let requesterEmployeeId = asEmployee ? asEmployee.id : null;
  if (!asEmployee && body && body.requesterEmployeeId) {
    if (!isUuid(body.requesterEmployeeId)) throw HttpError.badRequest('Invalid requesterEmployeeId');
    requesterEmployeeId = body.requesterEmployeeId;
  }
  let assetId = null;
  if (body && body.assetId) {
    if (!isUuid(body.assetId)) throw HttpError.badRequest('Invalid assetId');
    assetId = body.assetId;
  }

  const number = await nextNumber(type);
  const { responseDueAt, resolveDueAt } = slaDueDates(priority, new Date());
  const { rows } = await query(
    `INSERT INTO tickets (number, type, subject, description, priority, category,
        requester_employee_id, requester_user_id, asset_id, created_by, created_by_name, status,
        response_due_at, resolve_due_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, 'new', $12, $13)
     RETURNING id`,
    [number, type, subject, description || null, priority, category,
      requesterEmployeeId, asEmployee ? null : a.id, assetId, a.id, a.name,
      responseDueAt, resolveDueAt]
  );
  const id = rows[0].id;
  await logActivity(id, a, 'created', `${type} · ${priority}`);
  audit('ticket.create', `Opened ${number}: ${subject}`, a, id, number);
  return getTicket(id, user);
}

async function getTicket(id, user, { ownEmployeeId = null } = {}) {
  if (!isUuid(id)) throw HttpError.notFound('Ticket not found');
  const { rows } = await query(`SELECT ${SELECT_COLS} ${FROM_JOINS} WHERE t.id = $1`, [id]);
  const ticket = rows[0];
  if (!ticket) throw HttpError.notFound('Ticket not found');
  if (ownEmployeeId && String(ticket.requesterEmployeeId || '') !== String(ownEmployeeId)) {
    throw HttpError.forbidden('Not allowed to view this ticket');
  }
  const { rows: comments } = await query(
    `SELECT id, author_name AS "authorName", body, internal, created_at AS "createdAt"
       FROM ticket_comments WHERE ticket_id = $1 ${ownEmployeeId ? 'AND internal = false' : ''}
      ORDER BY created_at ASC`,
    [id]
  );
  ticket.comments = comments;
  if (!ownEmployeeId) {
    const { rows: activity } = await query(
      `SELECT actor_name AS "actorName", action, detail, created_at AS "createdAt"
         FROM ticket_activity WHERE ticket_id = $1 ORDER BY created_at ASC`, [id]
    );
    ticket.activity = activity;
  }
  return ownEmployeeId ? stripSla(ticket) : decorateSla(ticket);
}

async function listTickets(opts = {}) {
  const where = [];
  const params = [];
  const add = (cond, val) => { params.push(val); where.push(cond.replace('$?', '$' + params.length)); };
  if (opts.status && STATUSES.has(opts.status)) add('t.status = $?', opts.status);
  if (opts.type && TYPES.has(opts.type)) add('t.type = $?', opts.type);
  if (opts.assigneeUserId && isUuid(opts.assigneeUserId)) add('t.assignee_user_id = $?', opts.assigneeUserId);
  if (opts.open === true) where.push("t.status NOT IN ('resolved','closed','cancelled')");
  if (opts.assetId && isUuid(opts.assetId)) add('t.asset_id = $?', opts.assetId);
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const limit = Math.min(Math.max(Number(opts.limit) || 200, 1), 500);
  params.push(limit);
  const { rows } = await query(
    `SELECT ${SELECT_COLS} ${FROM_JOINS} ${whereSql} ORDER BY t.created_at DESC LIMIT $${params.length}`,
    params
  );
  return rows.map(decorateSla);
}

async function updateTicket(id, patch, user) {
  if (!isUuid(id)) throw HttpError.notFound('Ticket not found');
  const a = actor(user);
  let plan = null;
  await withTransaction(async (t) => {
    const { rows } = await t.query('SELECT * FROM tickets WHERE id = $1 FOR UPDATE', [id]);
    const cur = rows[0];
    if (!cur) throw HttpError.notFound('Ticket not found');

    const sets = [];
    const vals = [];
    const set = (col, val) => { vals.push(val); sets.push(`${col} = $${vals.length}`); };
    const acts = [];
    let statusTo = null;
    let newAssigneeId = null;

    if (patch.priority !== undefined) {
      if (!PRIORITIES.has(patch.priority)) throw HttpError.badRequest('Invalid priority');
      if (patch.priority !== cur.priority) {
        set('priority', patch.priority);
        acts.push(['priority', `${cur.priority} → ${patch.priority}`]);
        // Re-target the SLA clocks that haven't completed yet (relative to creation).
        const due = slaDueDates(patch.priority, cur.created_at);
        if (!cur.first_response_at) set('response_due_at', due.responseDueAt);
        if (!cur.resolved_at) set('resolve_due_at', due.resolveDueAt);
      }
    }
    if (patch.category !== undefined) set('category', patch.category ? String(patch.category).trim().slice(0, 120) : null);
    if (patch.assetId !== undefined) {
      const next = patch.assetId || null;
      if (next && !isUuid(next)) throw HttpError.badRequest('Invalid assetId');
      if (String(next || '') !== String(cur.asset_id || '')) {
        set('asset_id', next);
        acts.push(['asset', next ? 'linked' : 'unlinked']);
      }
    }
    if (patch.assigneeUserId !== undefined) {
      const next = patch.assigneeUserId || null;
      if (next && !isUuid(next)) throw HttpError.badRequest('Invalid assigneeUserId');
      if (String(next || '') !== String(cur.assignee_user_id || '')) {
        set('assignee_user_id', next);
        acts.push(['assigned', next ? 'assigned' : 'unassigned']);
        newAssigneeId = next; // notify the new assignee (null on unassign → skipped)
      }
    }
    if (patch.status !== undefined) {
      if (!STATUSES.has(patch.status)) throw HttpError.badRequest('Invalid status');
      if (patch.status !== cur.status) {
        const allowed = TRANSITIONS[cur.status] || [];
        if (!allowed.includes(patch.status)) {
          throw HttpError.badRequest(`Cannot move a ticket from "${cur.status}" to "${patch.status}"`);
        }
        set('status', patch.status);
        acts.push(['status', `${cur.status} → ${patch.status}`]);
        statusTo = patch.status;
        if (patch.status === 'resolved') set('resolved_at', new Date());
        else if (patch.status === 'closed') set('closed_at', new Date());
        else if (['open', 'in_progress'].includes(patch.status)) { set('resolved_at', null); set('closed_at', null); }
      }
    }
    if (!sets.length) return;

    set('updated_at', new Date());
    vals.push(id);
    await t.query(`UPDATE tickets SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals);
    for (const [action, detail] of acts) {
      await t.query('INSERT INTO ticket_activity (ticket_id, actor_name, action, detail) VALUES ($1,$2,$3,$4)', [id, a.name, action, detail]);
    }
    audit('ticket.update', `Updated ${cur.number}`, a, id, cur.number);
    if (statusTo || newAssigneeId) {
      plan = { number: cur.number, subject: cur.subject, actorName: a.name,
        requesterEmployeeId: cur.requester_employee_id, statusTo, newAssigneeId };
    }
  });
  if (plan) notifyUpdate(plan);
  return getTicket(id, user);
}

async function addComment(id, body, user, { ownEmployeeId = null } = {}) {
  if (!isUuid(id)) throw HttpError.notFound('Ticket not found');
  const text = String((body && body.body) || '').trim().slice(0, 8000);
  if (!text) throw HttpError.badRequest('A comment body is required');
  const internal = !ownEmployeeId && !!(body && body.internal); // employees can't post internal notes
  const a = actor(user);
  // Ownership check for self-service authors.
  await getTicket(id, user, { ownEmployeeId });
  await query(
    'INSERT INTO ticket_comments (ticket_id, author_user_id, author_name, body, internal) VALUES ($1,$2,$3,$4,$5)',
    [id, a.id, a.name, text, internal]
  );
  // First staff reply stamps the response time.
  if (!ownEmployeeId) {
    await query('UPDATE tickets SET first_response_at = COALESCE(first_response_at, now()), updated_at = now() WHERE id = $1', [id]);
  }
  notifyComment({ id, ownEmployeeId, internal, snippet: text.slice(0, 200), actorName: a.name });
  return getTicket(id, user, { ownEmployeeId });
}

/* -------------------------- self-service (Portal) -------------------------- */

async function createMyTicket(body, user) {
  const emp = await employeeForUser(user);
  if (!emp) throw HttpError.forbidden('No employee record is linked to your account');
  // Employees may only open incidents/requests for themselves, at normal priority.
  return createTicket(
    { type: body && body.type, subject: body && body.subject, description: body && body.description },
    user, { asEmployee: emp }
  );
}

async function listMyTickets(user) {
  const emp = await employeeForUser(user);
  if (!emp) return [];
  const { rows } = await query(
    `SELECT ${SELECT_COLS} ${FROM_JOINS} WHERE t.requester_employee_id = $1 ORDER BY t.created_at DESC LIMIT 200`,
    [emp.id]
  );
  return rows.map(stripSla);
}

async function getMyTicket(id, user) {
  const emp = await employeeForUser(user);
  if (!emp) throw HttpError.forbidden('No employee record is linked to your account');
  return getTicket(id, user, { ownEmployeeId: emp.id });
}

async function addMyComment(id, body, user) {
  const emp = await employeeForUser(user);
  if (!emp) throw HttpError.forbidden('No employee record is linked to your account');
  return addComment(id, body, user, { ownEmployeeId: emp.id });
}

/**
 * Stamp newly-breached SLA legs (once each) and log them to ticket_activity.
 * Called from the 1-minute scheduler tick. The `<> breached_at IS NULL` guard
 * plus the RETURNING set makes each breach fire exactly one activity row, even
 * across overlapping ticks. Safe to run when the module is off (matches nothing).
 */
async function sweepSlaBreaches() {
  const legs = [
    { col: 'response_breached_at', done: 'first_response_at', due: 'response_due_at', action: 'sla_response', detail: 'First-response SLA breached' },
    { col: 'resolve_breached_at', done: 'resolved_at', due: 'resolve_due_at', action: 'sla_resolve', detail: 'Resolution SLA breached' },
  ];
  let flagged = 0;
  for (const l of legs) {
    const { rows } = await query(
      `UPDATE tickets SET ${l.col} = now()
        WHERE ${l.col} IS NULL AND ${l.done} IS NULL AND ${l.due} IS NOT NULL AND ${l.due} < now()
          AND status NOT IN ('resolved','closed','cancelled')
        RETURNING id, number`
    );
    for (const r of rows) {
      await query(
        'INSERT INTO ticket_activity (ticket_id, actor_name, action, detail) VALUES ($1,$2,$3,$4)',
        [r.id, 'system', l.action, l.detail]
      );
      flagged += 1;
    }
  }
  return flagged;
}

/* --------------------------- email notifications --------------------------- */

async function partyEmails({ requesterEmployeeId, assigneeUserId }) {
  const out = { requesterEmail: null, assigneeEmail: null };
  if (requesterEmployeeId) {
    const r = await query('SELECT email FROM employees WHERE id = $1', [requesterEmployeeId]);
    out.requesterEmail = (r.rows[0] && r.rows[0].email) || null;
  }
  if (assigneeUserId) {
    const r = await query('SELECT email FROM users WHERE id = $1', [assigneeUserId]);
    out.assigneeEmail = (r.rows[0] && r.rows[0].email) || null;
  }
  return out;
}

// Fire-and-forget: never let a mail hiccup touch the ticket write path.
function mail(opts) {
  try {
    require('./notificationService').sendTicketNotification(opts).catch(() => {});
  } catch { /* ignore */ }
}

// Notify after an update (status change → requester; new assignee → assignee).
function notifyUpdate(plan) {
  (async () => {
    const p = await partyEmails({ requesterEmployeeId: plan.requesterEmployeeId, assigneeUserId: plan.newAssigneeId });
    if (plan.statusTo && p.requesterEmail) {
      mail({ to: p.requesterEmail, ticketNumber: plan.number, subject: plan.subject, event: `status changed to “${plan.statusTo}”`, actorName: plan.actorName });
    }
    if (plan.newAssigneeId && p.assigneeEmail) {
      mail({ to: p.assigneeEmail, ticketNumber: plan.number, subject: plan.subject, event: 'assigned to you', actorName: plan.actorName });
    }
  })().catch(() => {});
}

// Notify after a comment (staff public reply → requester; employee reply → assignee).
function notifyComment({ id, ownEmployeeId, internal, snippet, actorName }) {
  if (internal) return; // internal notes never leave the building
  (async () => {
    const meta = (await query(
      'SELECT number, subject, requester_employee_id AS "requesterEmployeeId", assignee_user_id AS "assigneeUserId" FROM tickets WHERE id = $1', [id]
    )).rows[0];
    if (!meta) return;
    const p = await partyEmails(meta);
    if (!ownEmployeeId && p.requesterEmail) {
      mail({ to: p.requesterEmail, ticketNumber: meta.number, subject: meta.subject, event: 'a new reply was posted', actorName, snippet });
    } else if (ownEmployeeId && p.assigneeEmail) {
      mail({ to: p.assigneeEmail, ticketNumber: meta.number, subject: meta.subject, event: 'the requester replied', actorName, snippet });
    }
  })().catch(() => {});
}

function audit(action, summary, a, entityId, label) {
  try {
    require('./auditService').logEvent({
      action, source: 'ticket', summary,
      actorId: a.id, actorEmail: a.email, actorName: a.name,
      entityType: 'ticket', entityId, entityLabel: label,
    }).catch(() => {});
  } catch { /* never block on audit */ }
}

module.exports = {
  createTicket, getTicket, listTickets, updateTicket, addComment,
  createMyTicket, listMyTickets, getMyTicket, addMyComment,
  sweepSlaBreaches, SLA_TARGETS,
};
