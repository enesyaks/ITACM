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
const { blockableAddress } = require('../../utils/mailFilter');

const TYPES = new Set(['incident', 'request']);
const PRIORITIES = new Set(['low', 'medium', 'high', 'urgent']);
const STATUSES = new Set(['new', 'open', 'in_progress', 'pending', 'resolved', 'closed', 'cancelled']);
const TERMINAL = new Set(['resolved', 'closed', 'cancelled']);
const LEVELS = new Set(['low', 'medium', 'high']);
const RESOLUTION_CODES = new Set(['fixed', 'workaround', 'no_fault', 'duplicate', 'not_reproducible', 'user_education', 'spam']);

// ITIL priority = Impact × Urgency (rows = impact, cols = urgency).
const PRIORITY_MATRIX = Object.freeze({
  high: { high: 'urgent', medium: 'high', low: 'medium' },
  medium: { high: 'high', medium: 'medium', low: 'low' },
  low: { high: 'medium', medium: 'low', low: 'low' },
});
function derivePriority(impact, urgency) {
  return (PRIORITY_MATRIX[impact] && PRIORITY_MATRIX[impact][urgency]) || 'medium';
}

/** Next level up; 'high' is the ceiling. */
function raiseLevel(level) {
  if (level === 'low') return 'medium';
  if (level === 'medium') return 'high';
  return 'high';
}

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

const PRIORITY_ORDER = ['low', 'medium', 'high', 'urgent'];

function sanitizeMins(v, dflt) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 1 && n <= 100000 ? n : dflt;
}

// Effective SLA targets = stored overrides (app_settings.sla_json) merged over
// the code defaults. Cached briefly so the ticket write path stays a single read.
let _slaCache = null;
let _slaCacheAt = 0;
async function getSlaConfig() {
  if (_slaCache && Date.now() - _slaCacheAt < 60 * 1000) return _slaCache;
  let stored = {};
  try {
    const { rows } = await query('SELECT sla_json FROM app_settings WHERE id = 1');
    if (rows[0] && rows[0].sla_json && typeof rows[0].sla_json === 'object') stored = rows[0].sla_json;
  } catch { stored = {}; }
  const merged = {};
  for (const p of PRIORITY_ORDER) {
    const d = SLA_TARGETS[p];
    const o = stored[p] || {};
    merged[p] = { responseMins: sanitizeMins(o.responseMins, d.responseMins), resolveMins: sanitizeMins(o.resolveMins, d.resolveMins) };
  }
  _slaCache = merged;
  _slaCacheAt = Date.now();
  return merged;
}

async function saveSlaConfig(input) {
  const out = {};
  for (const p of PRIORITY_ORDER) {
    const d = SLA_TARGETS[p];
    const o = (input && input[p]) || {};
    out[p] = { responseMins: sanitizeMins(o.responseMins, d.responseMins), resolveMins: sanitizeMins(o.resolveMins, d.resolveMins) };
    if (out[p].responseMins > out[p].resolveMins) {
      throw HttpError.badRequest(`${p}: first-response target cannot exceed the resolution target`);
    }
  }
  await query('UPDATE app_settings SET sla_json = $1::jsonb WHERE id = 1', [JSON.stringify(out)]);
  _slaCache = null;
  return getSlaConfig();
}

function addMinutes(from, mins) {
  return new Date(new Date(from).getTime() + mins * 60 * 1000);
}
function slaDueDates(targets, priority, from) {
  const tgt = targets[priority] || targets.medium || SLA_TARGETS.medium;
  return { responseDueAt: addMinutes(from, tgt.responseMins), resolveDueAt: addMinutes(from, tgt.resolveMins) };
}

// Live SLA state for one leg. `doneAt` is when that leg completed
// (first_response_at / resolved_at); once set it fixes met-vs-breached.
// `pausedAt` (resolution leg only) freezes the countdown while 'pending'.
function legState(dueAt, doneAt, open, pausedAt) {
  if (!dueAt) return { state: 'none' };
  const due = new Date(dueAt).getTime();
  if (doneAt) return { state: new Date(doneAt).getTime() <= due ? 'met' : 'breached', dueAt };
  if (!open) return { state: 'na', dueAt }; // closed/cancelled without ever completing this leg
  if (pausedAt) {
    const rem = due - new Date(pausedAt).getTime();
    return { state: 'paused', dueAt, remainingMs: rem > 0 ? rem : 0 };
  }
  const now = Date.now();
  return now > due ? { state: 'breached', dueAt } : { state: 'due', dueAt, remainingMs: due - now };
}

const SLA_RAW = ['responseDueAt', 'resolveDueAt', 'responseBreachedAt', 'resolveBreachedAt', 'slaPausedAt'];

// Attach a compact `sla` object for staff views; drop the raw columns either way.
function decorateSla(row) {
  const open = !TERMINAL.has(row.status);
  const paused = row.status === 'pending' ? row.slaPausedAt : null;
  row.sla = {
    response: legState(row.responseDueAt, row.firstResponseAt, open),
    resolve: legState(row.resolveDueAt, row.resolvedAt, open, paused),
  };
  for (const k of SLA_RAW) delete row[k];
  return row;
}
function stripSla(row) {
  for (const k of SLA_RAW) delete row[k];
  // Portal payloads don't expose internal problem linkage or the resolution code
  // (the plain-language resolution note + the requester's own CSAT stay visible).
  delete row.problemId; delete row.problemNumber; delete row.problemTitle;
  delete row.resolutionCode;
  // Nor the ticket this one was linked to as a duplicate: its master usually
  // belongs to SOMEBODY ELSE — four people report one printer — and its subject
  // is that person's words. The requester is told their own status, not another
  // requester's business.
  delete row.linkedToId; delete row.linkedToNumber;
  delete row.linkedToSubject; delete row.linkedToStatus;
  delete row.requesterEmail;
  return row;
}

// Allowed status transitions (from → [to]). Missing / same-state = rejected.
// This is the built-in DEFAULT; an admin can override the map from the Workflow
// editor (stored in app_settings.ticket_workflow_json). getWorkflow() merges the
// stored override over these defaults.
const DEFAULT_TRANSITIONS = Object.freeze({
  new: ['open', 'in_progress', 'cancelled'],
  open: ['in_progress', 'pending', 'resolved', 'cancelled'],
  in_progress: ['open', 'pending', 'resolved', 'cancelled'],
  pending: ['in_progress', 'resolved', 'cancelled'],
  resolved: ['closed', 'in_progress'],
  closed: ['in_progress'],
  cancelled: [],
});
const STATUS_ORDER = ['new', 'open', 'in_progress', 'pending', 'resolved', 'closed', 'cancelled'];

// Effective transition map = stored override (validated to the known statuses)
// or the built-in default when nothing is stored. Cached briefly like SLA.
let _wfCache = null;
let _wfCacheAt = 0;
function sanitizeTransitions(input) {
  const out = {};
  for (const from of STATUS_ORDER) {
    const raw = Array.isArray(input && input[from]) ? input[from] : [];
    const seen = new Set();
    out[from] = [];
    for (const to of raw) {
      if (STATUSES.has(to) && to !== from && !seen.has(to)) { seen.add(to); out[from].push(to); }
    }
  }
  return out;
}
async function getWorkflow() {
  if (_wfCache && Date.now() - _wfCacheAt < 60 * 1000) return _wfCache;
  let stored = null; let autoClose = 0;
  try {
    const { rows } = await query('SELECT ticket_workflow_json FROM app_settings WHERE id = 1');
    const j = rows[0] && rows[0].ticket_workflow_json;
    if (j && typeof j === 'object') {
      if (j.transitions && typeof j.transitions === 'object') stored = j.transitions;
      autoClose = sanitizeDays(j.autoCloseResolvedDays);
    }
  } catch { stored = null; }
  const transitions = stored ? sanitizeTransitions(stored) : sanitizeTransitions(DEFAULT_TRANSITIONS);
  _wfCache = {
    transitions,
    defaults: sanitizeTransitions(DEFAULT_TRANSITIONS),
    statuses: STATUS_ORDER.slice(),
    terminal: [...TERMINAL],
    autoCloseResolvedDays: autoClose,
    customized: !!stored,
  };
  _wfCacheAt = Date.now();
  return _wfCache;
}
function sanitizeDays(x) {
  const n = Math.floor(Number(x) || 0);
  return Math.max(0, Math.min(365, Number.isFinite(n) ? n : 0));
}

async function saveWorkflow(input) {
  const transitions = sanitizeTransitions((input && input.transitions) || input || {});
  const autoCloseResolvedDays = sanitizeDays(input && input.autoCloseResolvedDays);
  // Guardrail: every non-terminal status needs at least one way out, or a ticket
  // could get stuck forever. Terminal states (resolved/closed/cancelled) may be
  // dead-ends by design, so they're exempt.
  for (const from of STATUS_ORDER) {
    if (!TERMINAL.has(from) && transitions[from].length === 0) {
      throw HttpError.badRequest(`Status "${from}" has no outgoing transition — a ticket would get stuck there`);
    }
  }
  await query('UPDATE app_settings SET ticket_workflow_json = $1::jsonb WHERE id = 1', [JSON.stringify({ transitions, autoCloseResolvedDays })]);
  _wfCache = null;
  return getWorkflow();
}

/**
 * Automation: close 'resolved' tickets that have sat untouched past the
 * configured number of days (Workflow → auto-close). 0 = off. Records an
 * activity line and cascades nothing (they're already resolved). Never throws.
 */
async function sweepAutoCloseResolved() {
  try {
    const wf = await getWorkflow();
    const days = wf.autoCloseResolvedDays;
    if (!days) return 0;
    const { rows } = await query(
      `UPDATE tickets SET status='closed', closed_at=now(), updated_at=now()
        WHERE status='resolved' AND resolved_at IS NOT NULL AND resolved_at < now() - ($1 || ' days')::interval
        RETURNING id`,
      [String(days)]
    );
    for (const r of rows) {
      logActivity(r.id, { name: 'system' }, 'auto_closed', `Auto-closed after ${days} day(s) resolved`).catch(() => {});
    }
    return rows.length;
  } catch { return 0; }
}
function resetWorkflow() {
  return saveWorkflow({ transitions: DEFAULT_TRANSITIONS });
}

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
  t.impact, t.urgency,
  t.requester_employee_id AS "requesterEmployeeId", re.full_name AS "requesterName",
  COALESCE(re.vip, false) AS "requesterVip",
  t.assignee_user_id AS "assigneeUserId", au.username AS "assigneeName",
  t.asset_id AS "assetId", a.asset_tag AS "assetTag",
  t.problem_id AS "problemId", pr.number AS "problemNumber", pr.title AS "problemTitle",
  ar.status AS "approvalStatus", ar.approver_name AS "approvalApprover", ar.history AS "approvalHistory",
  t.created_by_name AS "createdByName",
  t.resolution_code AS "resolutionCode", t.resolution_note AS "resolutionNote",
  t.csat_rating AS "csatRating", t.csat_comment AS "csatComment",
  t.first_response_at AS "firstResponseAt", t.resolved_at AS "resolvedAt", t.closed_at AS "closedAt",
  t.response_due_at AS "responseDueAt", t.resolve_due_at AS "resolveDueAt",
  t.response_breached_at AS "responseBreachedAt", t.resolve_breached_at AS "resolveBreachedAt",
  t.sla_paused_at AS "slaPausedAt",
  t.linked_to_id AS "linkedToId", lt.number AS "linkedToNumber",
  lt.subject AS "linkedToSubject", lt.status AS "linkedToStatus",
  t.requester_email AS "requesterEmail",
  t.created_at AS "createdAt", t.updated_at AS "updatedAt"`;
const FROM_JOINS = `
  FROM tickets t
  LEFT JOIN employees re ON t.requester_employee_id = re.id
  LEFT JOIN users au     ON t.assignee_user_id = au.id
  LEFT JOIN assets a     ON t.asset_id = a.id
  LEFT JOIN problems pr  ON t.problem_id = pr.id
  LEFT JOIN approval_requests ar ON t.approval_request_id = ar.id
  LEFT JOIN tickets lt   ON t.linked_to_id = lt.id`;

/** Resolve the employee row that owns a self-service (Portal) session, by email. */
async function employeeForUser(user) {
  const email = String((user && user.email) || '').trim().toLowerCase();
  if (!email) return null;
  const { rows } = await query('SELECT id, full_name FROM employees WHERE lower(email) = $1 LIMIT 1', [email]);
  return rows[0] || null;
}

/**
 * Open the approval a request template requires for a just-created ticket, if any.
 * Shared by the portal (createMyTicket) and staff (createTicket) paths. Amount-
 * gated: below the template threshold the fixed emp: approvers are dropped. No-op
 * when the template has no chain or the ticket has no requester to route from.
 */
async function applyTemplateApproval(ticket, template, { amount, requesterEmployeeId, requesterName } = {}) {
  if (!template || !Array.isArray(template.approvalLevels) || !template.approvalLevels.length) return;
  if (!requesterEmployeeId) return;
  const amt = Number(amount);
  const hasAmount = Number.isFinite(amt) && amt >= 0;
  let levels = template.approvalLevels;
  // A fixed approver (emp:<uuid> — e.g. finance sign-off) may be dropped ONLY when
  // the requester-declared amount is present AND provably below the threshold.
  // A missing/zero/unverified amount fails CLOSED — the fixed approver stays — so a
  // requester can't strip the high-value approver by sending amount:0 or omitting it.
  if (template.amountThreshold != null && Number.isFinite(Number(template.amountThreshold))) {
    const belowThreshold = hasAmount && amt > 0 && amt < Number(template.amountThreshold);
    if (belowThreshold) levels = levels.filter((l) => !(typeof l === 'string' && l.startsWith('emp:')));
  }
  if (!levels.length) return;
  const approval = await require('./approvalService').createRequest({
    type: 'ticket_request',
    requesterEmployeeId,
    requesterName: requesterName || null,
    payload: { ticketId: ticket.id, amount: hasAmount ? amt : null },
    resourceRef: ticket.number,
    summary: `${template.name}: ${ticket.subject}${hasAmount ? ` — ₺${amt.toLocaleString('tr-TR')}` : ''}`,
    levels,
  }).catch((err) => {
    // Don't fail silently: a chain that should exist but couldn't be opened must be
    // visible, not swallowed into an unapproved ticket.
    console.error('[tickets] approval chain could not be opened for', ticket.number, '-', err && err.message);
    return { required: false, error: true };
  });
  if (approval && approval.required && approval.request) {
    await query('UPDATE tickets SET approval_request_id = $1 WHERE id = $2', [approval.request.id, ticket.id]);
    logActivity(ticket.id, { name: 'system' }, 'approval_requested', `Pending ${levels.join(' → ')}`).catch(() => {});
  }
}

/**
 * Creation-time automation: run the enabled rules against the new ticket and
 * apply the merged outcome (category / impact / urgency / priority / assignee /
 * an internal note).
 *
 * Runs exactly once, at creation, and never re-enters: the writes below go
 * straight to SQL rather than through updateTicket, so a rule cannot trigger
 * another evaluation pass. It also bypasses the IAM assign check on purpose —
 * the actor here is the rule set, configured by someone who already holds
 * `ticket:configure`, not the person opening the ticket.
 *
 * Never throws: a broken rule must not cost the user their ticket.
 */
async function applyRules(ticket, ctx, a) {
  const ruleService = require('./ticketRuleService');
  let outcome = null;
  try {
    const rules = await ruleService.activeRules();
    if (!rules.length) return null;
    outcome = ruleService.evaluateRules(rules, ctx);
  } catch (err) {
    console.error('[tickets] rule evaluation failed for', ticket.number, '-', err && err.message);
    return null;
  }
  if (!outcome.matched.length) return null;

  try {
    const act = outcome.actions || {};
    const sets = [];
    const vals = [];
    const set = (col, val) => { vals.push(val); sets.push(`${col} = $${vals.length}`); };
    const changed = [];

    if (act.setCategory && act.setCategory !== ticket.category) {
      set('category', act.setCategory);
      changed.push(`category → ${act.setCategory}`);
    }
    const effImpact = act.setImpact || ticket.impact;
    const effUrgency = act.setUrgency || ticket.urgency;
    if (act.setImpact && act.setImpact !== ticket.impact) { set('impact', act.setImpact); changed.push(`impact → ${act.setImpact}`); }
    if (act.setUrgency && act.setUrgency !== ticket.urgency) { set('urgency', act.setUrgency); changed.push(`urgency → ${act.setUrgency}`); }
    // Impact × Urgency wins over an explicit setPriority, matching the manual
    // edit path (updateTicket) so the two can never disagree.
    const nextPriority = (effImpact && effUrgency && (act.setImpact || act.setUrgency))
      ? derivePriority(effImpact, effUrgency)
      : (act.setPriority || null);
    if (nextPriority && nextPriority !== ticket.priority) {
      set('priority', nextPriority);
      changed.push(`priority → ${nextPriority}`);
      // The SLA clocks were stamped from the pre-rule priority; re-target them
      // from creation so an escalated ticket gets the tighter deadline it earned.
      const due = slaDueDates(await getSlaConfig(), nextPriority, ticket.createdAt);
      set('response_due_at', due.responseDueAt);
      set('resolve_due_at', due.resolveDueAt);
    }
    if (act.setAssigneeUserId && act.setAssigneeUserId !== ticket.assigneeUserId) {
      set('assignee_user_id', act.setAssigneeUserId);
      changed.push('assigned');
    }
    if (sets.length) {
      vals.push(ticket.id);
      await query(`UPDATE tickets SET ${sets.join(', ')}, updated_at = now() WHERE id = $${vals.length}`, vals);
    }
    if (act.addNote) {
      await query(
        'INSERT INTO ticket_comments (ticket_id, author_name, body, internal, staff_only) VALUES ($1,$2,$3,true,false)',
        [ticket.id, 'Automation', act.addNote]
      );
    }
    const names = outcome.matched.map((m) => m.name).join(', ');
    await logActivity(ticket.id, { name: 'Automation' }, 'rule_applied',
      `${names}${changed.length ? ': ' + changed.join(', ') : ''}`);
    audit('ticket.rule_applied', `${ticket.number}: ${names}${changed.length ? ' — ' + changed.join(', ') : ''}`,
      a, ticket.id, ticket.number);
    await ruleService.recordMatches(outcome.matched.map((m) => m.id));
  } catch (err) {
    // The ticket already exists and is valid; log loudly and move on.
    console.error('[tickets] rule actions failed for', ticket.number, '-', err && err.message);
  }
  return outcome;
}

async function createTicket(body, user, { asEmployee = null, source = 'staff', senderEmail = '', junk = null } = {}) {
  // Optional request template: forces type=request and carries a category + an
  // approval chain that must clear before the desk fulfils the request.
  let template = null;
  if (body && body.templateId) {
    template = await require('./requestTemplateService').getTemplate(body.templateId).catch(() => null);
    if (!template || !template.enabled) throw HttpError.badRequest('Invalid request template');
  }
  const type = template ? 'request' : (TYPES.has(body && body.type) ? body.type : 'incident');
  const subject = String((body && body.subject) || '').trim().slice(0, 300);
  if (!subject) throw HttpError.badRequest('A subject is required');
  const description = String((body && body.description) || '').trim().slice(0, 8000);
  // Priority is derived from Impact × Urgency when both are given; otherwise an
  // explicit priority (or the medium default) is used.
  const impact = LEVELS.has(body && body.impact) ? body.impact : null;
  const urgency = LEVELS.has(body && body.urgency) ? body.urgency : null;
  const category = template ? (template.category || null)
    : (body && body.category ? String(body.category).trim().slice(0, 120) : null);
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

  // VIP requester: their downtime costs more, so urgency goes up a step and the
  // Impact × Urgency matrix carries that into priority and the SLA clock — the
  // ITIL chain stays intact instead of a priority being pinned from the side.
  //
  // Only when nobody chose an urgency. The staff form applies the same raise
  // visibly while it is being filled in, so whatever it sends is a human's
  // decision; overriding it here would silently undo an operator who
  // deliberately dialled a VIP's request back down. This branch is for the
  // paths where no one picked: the self-service portal, inbound email, the API.
  let effImpact = impact;
  let effUrgency = urgency;
  if (!urgency && requesterEmployeeId) {
    const { rows: vipRows } = await query(
      'SELECT vip FROM employees WHERE id = $1', [requesterEmployeeId]
    ).catch(() => ({ rows: [] }));
    if (vipRows[0] && vipRows[0].vip) {
      effUrgency = raiseLevel('medium');
      effImpact = effImpact || 'medium';
    }
  }
  const priority = (effImpact && effUrgency)
    ? derivePriority(effImpact, effUrgency)
    : (PRIORITIES.has(body && body.priority) ? body.priority : 'medium');

  const number = await nextNumber(type);
  // Junk mail is recorded and shut in the same act: it arrived, this is what it
  // was, and it was never work. No SLA clock is started — a newsletter must not
  // count against the desk's response time — and nothing is sent back to the
  // sender, because answering an advert is how an address gets more of them.
  const { responseDueAt, resolveDueAt } = junk
    ? { responseDueAt: null, resolveDueAt: null }
    : slaDueDates(await getSlaConfig(), priority, new Date());
  // The address an emailed ticket arrived from is kept even when it matches an
  // employee: it is how "the same sender wrote twice" is answered for people the
  // install has no row for, and it costs nothing to store for the ones it does.
  const fromAddr = source === 'email' ? String(senderEmail || '').trim().slice(0, 320) || null : null;
  const { rows } = await query(
    `INSERT INTO tickets (number, type, subject, description, priority, category,
        requester_employee_id, requester_user_id, asset_id, created_by, created_by_name, status,
        response_due_at, resolve_due_at, impact, urgency, requester_email,
        closed_at, resolution_code, resolution_note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$17, $12, $13, $14, $15, $16, $18, $19, $20)
     RETURNING id`,
    [number, type, subject, description || null, junk ? 'low' : priority, category,
      requesterEmployeeId, asEmployee ? null : a.id, assetId, a.id, a.name,
      responseDueAt, resolveDueAt, effImpact, effUrgency, fromAddr,
      junk ? 'closed' : 'new', junk ? new Date() : null,
      junk ? 'spam' : null, junk ? String(junk.reason || 'bulk mail').slice(0, 500) : null]
  );
  const id = rows[0].id;
  await logActivity(id, a, 'created', `${type} · ${junk ? 'low' : priority}`);
  if (junk) await logActivity(id, a, 'status', `closed as spam — ${junk.reason || 'bulk mail'}`);
  audit('ticket.create', `Opened ${number}: ${subject}`, a, id, number);
  // Rules can categorise, escalate and assign; none of that is wanted for a
  // ticket that is already shut, and an assignment would put junk in a queue.
  if (junk) return getTicket(id, user);

  // Automation rules run BEFORE the approval chain: a rule may re-categorise or
  // escalate the ticket, and the approval summary should carry the final values.
  const created = await getTicket(id, user);
  let requester = null;
  if (created.requesterEmployeeId) {
    const r = await query('SELECT email, department FROM employees WHERE id = $1', [created.requesterEmployeeId]).catch(() => null);
    requester = (r && r.rows[0]) || null;
  }
  await applyRules(created, {
    subject,
    description: description || '',
    category: created.category || '',
    type,
    source,
    requesterName: created.requesterName || '',
    // An unverified email sender has no employee row; the raw From: address is
    // still the most useful thing a rule can match on.
    requesterEmail: (requester && requester.email) || senderEmail || '',
    requesterDepartment: (requester && requester.department) || '',
    templateName: (template && template.name) || '',
  }, a);

  if (template) {
    const t0 = await getTicket(id, user);
    await applyTemplateApproval(t0, template, {
      amount: body && body.amount,
      requesterEmployeeId: t0.requesterEmployeeId,
      requesterName: t0.requesterName,
    });
  }
  const final = await getTicket(id, user);
  // Read after the rules and the approval chain have run, so the receipt quotes
  // the priority the ticket actually ended up with.
  ackRequester(final, { requesterEmail: (requester && requester.email) || '', senderEmail });
  return final;
}

/**
 * Who, if anyone, gets the receipt — kept as a pure function because the rule is
 * the whole feature and it has to be readable on its own.
 *
 * A requester the install knows (an employee row, however the ticket was raised)
 * is always written back to. An address that matches nobody only exists on the
 * email intake, and answering it is a decision a desk has to make: an auto-reply
 * to an unknown address confirms the mailbox is live to whoever sent it, which
 * is exactly what a spam run is looking for. So that half is off until switched
 * on, and then it goes to the raw From: address.
 */
function ackTarget({ requesterEmail, senderEmail, ackUnknown }) {
  const known = String(requesterEmail || '').trim();
  if (known) return { to: known, known: true };
  const raw = String(senderEmail || '').trim();
  if (!raw || !ackUnknown) return null;
  return { to: raw, known: false };
}

// Fire-and-forget receipt: a mail problem must never fail the ticket write.
function ackRequester(ticket, { requesterEmail, senderEmail }) {
  (async () => {
    const svc = require('./notificationService');
    const cfg = await svc.getMailConfig();
    const target = ackTarget({
      requesterEmail, senderEmail,
      ackUnknown: !!(cfg.notify && cfg.notify.ackUnknownSenders),
    });
    if (!target) return;
    await svc.sendTicketAck({
      to: target.to,
      ticketId: ticket.id,
      ticketNumber: ticket.number,
      subject: ticket.subject,
      requesterName: ticket.requesterName || target.to,
      priority: ticket.priority,
    });
  })().catch(() => {});
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
    `SELECT id, author_name AS "authorName", body, internal, staff_only AS "staffOnly", created_at AS "createdAt"
       FROM ticket_comments WHERE ticket_id = $1 ${ownEmployeeId ? 'AND internal = false' : ''}
      ORDER BY created_at ASC`,
    [id]
  );
  // Attach each comment's linked files so they render beneath it. Portal payloads
  // never expose internal attachments.
  const { rows: cdocs } = await query(
    `SELECT id, comment_id AS "commentId", filename, mime, byte_size AS "byteSize"
       FROM ticket_documents WHERE ticket_id = $1 AND comment_id IS NOT NULL ${ownEmployeeId ? 'AND internal = false' : ''}
      ORDER BY created_at ASC`,
    [id]
  );
  const docsByComment = {};
  for (const d of cdocs) { (docsByComment[d.commentId] = docsByComment[d.commentId] || []).push(d); }
  for (const c of comments) { c.documents = docsByComment[c.id] || []; }
  ticket.comments = comments;
  if (!ownEmployeeId) {
    const { rows: activity } = await query(
      `SELECT actor_name AS "actorName", action, detail, created_at AS "createdAt"
         FROM ticket_activity WHERE ticket_id = $1 ORDER BY created_at ASC`, [id]
    );
    ticket.activity = activity;
    ticket.similar = await findSimilar(ticket);
    ticket.linked = await linkedTickets(id);
    // Only worth offering when this ticket can actually take followers.
    ticket.duplicateCandidates = ticket.linkedToId ? [] : await duplicateCandidates(ticket);
  }
  return ownEmployeeId ? stripSla(ticket) : decorateSla(ticket);
}

/**
 * Past tickets that look related to this one — the same requester (recurring
 * issue for that person) or a similar subject / category. Staff-side hint shown
 * in the ticket detail so IT can spot repeats. Most-recent first, same-requester
 * matches ranked first. Best-effort — never throws.
 */
async function findSimilar(ticket) {
  try {
    const reqId = ticket.requesterEmployeeId || null;
    const words = String(ticket.subject || '').toLowerCase()
      .split(/[^a-z0-9çğışöüâîû]+/i).filter((w) => w.length >= 4).slice(0, 5);
    const patterns = words.map((w) => '%' + w + '%');
    if (!reqId && !patterns.length && !ticket.category) return [];
    const params = [ticket.id, reqId];
    const conds = ['t.requester_employee_id = $2'];
    if (patterns.length) { params.push(patterns); conds.push(`t.subject ILIKE ANY($${params.length})`); }
    if (ticket.category) { params.push(ticket.category); conds.push(`t.category = $${params.length}`); }
    const catIdx = ticket.category ? params.length : 0; // category was pushed last, if present
    const { rows } = await query(
      `SELECT t.id, t.number, t.subject, t.status, t.priority, t.category,
              t.resolution_note AS "resolutionNote", t.resolution_code AS "resolutionCode",
              t.csat_rating AS "csatRating", t.created_at AS "createdAt",
              (t.requester_employee_id = $2) AS "sameRequester"${catIdx ? `, (t.category = $${catIdx}) AS "sameCategory"` : ', false AS "sameCategory"'}
         FROM tickets t
        WHERE t.id <> $1 AND (${conds.join(' OR ')})
        ORDER BY (t.status IN ('resolved','closed')) DESC, "sameRequester" DESC NULLS LAST, t.created_at DESC
        LIMIT 6`, params
    );
    return rows;
  } catch { return []; }
}

/**
 * Close a ticket an advert opened, and optionally stop the sender writing again.
 *
 * The bulk filter reads headers only and deliberately so — guessing from words
 * would silently drop a real request from a supplier — which means marketing
 * that bothers to look like a person gets through. When it does, the desk needs
 * one action rather than five: classify it, close it, take the clock off it, and
 * decide about the sender.
 *
 * The SLA is not "met" here, it is REMOVED: an advert must not appear in the
 * response-time figures at all, in either direction, so the due dates and any
 * breach marks are cleared rather than stamped. It closes without the usual
 * "classify before you close" rule for the same reason a linked duplicate does —
 * that rule exists to hold a person to a process, and there is no process here.
 *
 * Blocking is a separate decision with a real cost: a wrongly blocked address
 * has its future requests dropped in silence. So it is asked, never assumed,
 * and it needs desk-configuration rights rather than the right to work a ticket.
 */
async function markSpam(id, { block = false, category = '' } = {}, user) {
  if (!isUuid(id)) throw HttpError.notFound('Ticket not found');
  const a = actor(user);
  const { rows } = await query(
    `SELECT number, status, requester_email, category,
            response_breached_at, resolve_breached_at
       FROM tickets WHERE id = $1`, [id]
  );
  const cur = rows[0];
  if (!cur) throw HttpError.notFound('Ticket not found');
  if (TERMINAL.has(cur.status)) throw HttpError.badRequest(`${cur.number} is already ${cur.status}`);
  // Removing the clock also removes any breach already recorded against it,
  // which is worth stating out loud in the trail: otherwise "close as advert"
  // is a way to make a missed SLA disappear with nothing to show for it.
  const erased = [cur.response_breached_at ? 'response breach' : '', cur.resolve_breached_at ? 'resolution breach' : '']
    .filter(Boolean).join(' + ');

  // Never taken straight from the stored address: the From header is written by
  // the sender, and one that parses to "@gmail.com" would normalise to the
  // DOMAIN entry "gmail.com" — silently blackholing every future request from
  // it. A message can only ever get its own address blocked.
  const sender = blockableAddress(cur.requester_email);
  // Asked BEFORE anything is written. The blocklist belongs to the mail
  // integration, so blocking is judged by integration:manage and nothing else:
  // gating it on a ticket permission opened a side door, since the Helpdesk role
  // is denied integration outright — it cannot even READ the blocklist — while
  // ticket:configure is part of its fallback. And refusing halfway would leave
  // the ticket closed by a call that reported failure.
  if (block && sender) {
    const allowed = await require('./permissionService').hasResourceAction(user, 'integration', 'manage');
    if (!allowed) throw HttpError.forbidden('Blocking a sender needs permission to manage the mail integration');
  }

  // The category is replaced, not filled in: whatever this was filed under, it
  // is junk, and leaving it as "Hardware" hides that from every report that
  // groups by category.
  const label = String(category || '').trim().slice(0, 120) || 'Spam';
  await query(
    `UPDATE tickets
        SET status = 'closed', closed_at = now(), updated_at = now(),
            resolution_code = 'spam',
            resolution_note = COALESCE(resolution_note, $2),
            category = $3,
            response_due_at = NULL, resolve_due_at = NULL,
            response_breached_at = NULL, resolve_breached_at = NULL,
            sla_paused_at = NULL
      WHERE id = $1`,
    [id, 'Reklam / toplu posta', label]
  );
  await logActivity(id, a, 'status',
    `${cur.status} → closed · spam (SLA cleared${erased ? `, erasing a recorded ${erased}` : ''})`);
  audit('ticket.update', `Closed ${cur.number} as spam`, a, id, cur.number);

  let blocked = null;
  if (block && sender) {
    const inbound = require('./inboundMailService');
    const curList = (await inbound.getBlocklist()).blocklist || [];
    if (!curList.includes(sender)) await inbound.saveBlocklist({ blocklist: [...curList, sender] });
    blocked = sender;
    await logActivity(id, a, 'blocked', `${sender} added to the blocked senders list`);
    audit('integration.update', `Blocked inbound sender ${sender} (from ${cur.number})`, a, id, cur.number);
  }

  // Duplicates of an advert are adverts: they go with it.
  await closeLinked(id, { status: 'closed', number: cur.number }, a);
  const ticket = await getTicket(id, user);
  ticket.blockedSender = blocked;
  return ticket;
}

/* ------------------------------- duplicates ------------------------------- */

/** The tickets that close when this one does. */
async function linkedTickets(id) {
  const { rows } = await query(
    `SELECT t.id, t.number, t.subject, t.status, t.priority, t.created_at AS "createdAt",
            re.full_name AS "requesterName"
       FROM tickets t
       LEFT JOIN employees re ON re.id = t.requester_employee_id
      WHERE t.linked_to_id = $1
      ORDER BY t.created_at ASC`, [id]
  );
  return rows;
}

/**
 * Other OPEN tickets from the same person, offered as candidates to link.
 *
 * "The same person" is two things, because a ticket can arrive with either
 * identity and sometimes only one: the employee row when the requester is known
 * to the install, and the address the mail came from when they are not. Matching
 * on both is what makes "the same sender wrote twice" work for an outsider who
 * has no employee record at all.
 *
 * Only open tickets, only unlinked ones, and never a ticket that already has
 * followers of its own — linking is one level deep, so a candidate that is
 * already somebody's master would have to be re-parented, which is a merge and
 * not what this is. Best-effort: never throws.
 */
async function duplicateCandidates(ticket) {
  try {
    if (!ticket) return [];
    const empId = ticket.requesterEmployeeId || null;
    const email = String(ticket.requesterEmail || '').trim().toLowerCase() || null;
    if (!empId && !email) return [];
    const { rows } = await query(
      `SELECT t.id, t.number, t.subject, t.status, t.priority, t.created_at AS "createdAt",
              re.full_name AS "requesterName", t.requester_email AS "requesterEmail"
         FROM tickets t
         LEFT JOIN employees re ON re.id = t.requester_employee_id
        WHERE t.id <> $1
          AND t.status NOT IN ('resolved', 'closed', 'cancelled')
          AND t.linked_to_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM tickets c WHERE c.linked_to_id = t.id)
          AND ( ($2::uuid IS NOT NULL AND t.requester_employee_id = $2)
             OR ($3::text IS NOT NULL AND lower(t.requester_email) = $3) )
        ORDER BY t.created_at DESC
        LIMIT 10`,
      [ticket.id, empId, email]
    );
    return rows;
  } catch { return []; }
}

/**
 * Link tickets to this one as duplicates of it. Their numbers, requesters and
 * history stay; what changes is that closing this ticket now closes them too.
 *
 * The rules exist so "what closes this" is always answerable in one hop:
 * a master may not itself be linked, a ticket that already has followers may not
 * become one, and nothing terminal is linked (there would be nothing to cascade).
 */
async function linkTickets(masterId, childIds, user) {
  if (!isUuid(masterId)) throw HttpError.notFound('Ticket not found');
  const ids = [...new Set((Array.isArray(childIds) ? childIds : [childIds])
    .map((x) => String(x || '')).filter(isUuid))];
  if (!ids.length) throw HttpError.badRequest('Choose at least one ticket to link');
  if (ids.includes(masterId)) throw HttpError.badRequest('A ticket cannot be linked to itself');

  const a = actor(user);
  const master = (await query('SELECT id, number, status, linked_to_id FROM tickets WHERE id = $1', [masterId])).rows[0];
  if (!master) throw HttpError.notFound('Ticket not found');
  if (master.linked_to_id) throw HttpError.badRequest('This ticket is itself linked to another one — link them to that one instead');

  const { rows: children } = await query(
    'SELECT id, number, status, linked_to_id FROM tickets WHERE id = ANY($1::uuid[])', [ids]
  );
  if (children.length !== ids.length) throw HttpError.notFound('One of those tickets no longer exists');
  for (const c of children) {
    if (TERMINAL.has(c.status)) throw HttpError.badRequest(`${c.number} is already ${c.status} — there is nothing left to link`);
    if (c.linked_to_id && c.linked_to_id !== masterId) throw HttpError.badRequest(`${c.number} is already linked to another ticket`);
    const { rows: own } = await query('SELECT number FROM tickets WHERE linked_to_id = $1 LIMIT 1', [c.id]);
    if (own[0]) throw HttpError.badRequest(`${c.number} has tickets linked to it already (${own[0].number}) — unlink those first`);
  }

  await query('UPDATE tickets SET linked_to_id = $1, updated_at = now() WHERE id = ANY($2::uuid[])', [masterId, ids]);
  for (const c of children) {
    await logActivity(c.id, a, 'linked', `linked to ${master.number}`);
  }
  await logActivity(masterId, a, 'linked', `${children.map((c) => c.number).join(', ')} linked to this ticket`);
  audit('ticket.link', `Linked ${children.map((c) => c.number).join(', ')} to ${master.number}`, a, masterId, master.number);
  return { linked: await linkedTickets(masterId) };
}

/** Detach one follower. Its own status is untouched — it just stops following. */
async function unlinkTicket(masterId, childId, user) {
  if (!isUuid(masterId) || !isUuid(childId)) throw HttpError.notFound('Ticket not found');
  const a = actor(user);
  const { rows } = await query(
    'UPDATE tickets SET linked_to_id = NULL, updated_at = now() WHERE id = $1 AND linked_to_id = $2 RETURNING number',
    [childId, masterId]
  );
  if (!rows[0]) throw HttpError.notFound('That ticket is not linked to this one');
  const master = (await query('SELECT number FROM tickets WHERE id = $1', [masterId])).rows[0];
  await logActivity(childId, a, 'linked', `unlinked from ${master ? master.number : 'the other ticket'}`);
  await logActivity(masterId, a, 'linked', `${rows[0].number} unlinked`);
  audit('ticket.unlink', `Unlinked ${rows[0].number} from ${master ? master.number : masterId}`, a, masterId, master && master.number);
  return { linked: await linkedTickets(masterId) };
}

// Whitelisted sort keys → SQL. Priority/status sort by workflow order, not
// alphabetically, so "sort by priority" surfaces the urgent ones.
const SORT_SQL = Object.freeze({
  created: 't.created_at',
  number: 't.number',
  subject: 't.subject',
  status: "CASE t.status WHEN 'new' THEN 1 WHEN 'open' THEN 2 WHEN 'in_progress' THEN 3 WHEN 'pending' THEN 4 WHEN 'resolved' THEN 5 WHEN 'closed' THEN 6 ELSE 7 END",
  priority: "CASE t.priority WHEN 'urgent' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END",
  sla: 't.resolve_due_at',
});

async function listTickets(opts = {}) {
  const where = [];
  const params = [];
  const add = (cond, val) => { params.push(val); where.push(cond.replace('$?', '$' + params.length)); };
  if (opts.status && STATUSES.has(opts.status)) add('t.status = $?', opts.status);
  if (opts.type && TYPES.has(opts.type)) add('t.type = $?', opts.type);
  if (opts.priority && PRIORITIES.has(opts.priority)) add('t.priority = $?', opts.priority);
  if (opts.category) add('t.category = $?', String(opts.category).slice(0, 120));
  if (opts.assigneeUserId && isUuid(opts.assigneeUserId)) add('t.assignee_user_id = $?', opts.assigneeUserId);
  if (opts.open === true) where.push("t.status NOT IN ('resolved','closed','cancelled')");
  if (opts.assetId && isUuid(opts.assetId)) add('t.asset_id = $?', opts.assetId);
  if (opts.search && String(opts.search).trim()) {
    params.push(`%${String(opts.search).trim().slice(0, 120)}%`);
    const p = '$' + params.length; // one bound param, referenced three times
    where.push(`(t.number ILIKE ${p} OR t.subject ILIKE ${p} OR re.full_name ILIKE ${p})`);
  }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const sortCol = SORT_SQL[opts.sort] || SORT_SQL.created;
  const dir = String(opts.order).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const orderSql = `ORDER BY ${sortCol} ${dir} NULLS LAST, t.created_at DESC`;

  const limit = Math.min(Math.max(Number(opts.limit) || 200, 1), 5000);
  params.push(limit);
  const { rows } = await query(
    `SELECT ${SELECT_COLS} ${FROM_JOINS} ${whereSql} ${orderSql} LIMIT $${params.length}`,
    params
  );
  return rows.map(decorateSla);
}

/* -------------------------- canned responses -------------------------- */

async function getCannedResponses() {
  try {
    const { rows } = await query('SELECT ticket_canned_json FROM app_settings WHERE id = 1');
    const raw = rows[0] && Array.isArray(rows[0].ticket_canned_json) ? rows[0].ticket_canned_json : [];
    return raw
      .filter((r) => r && typeof r === 'object')
      .map((r) => ({ title: String(r.title || '').slice(0, 120), body: String(r.body || '').slice(0, 4000) }))
      .filter((r) => r.title && r.body);
  } catch { return []; }
}

async function saveCannedResponses(input) {
  const list = Array.isArray(input) ? input : [];
  const out = list
    .map((r) => ({ title: String((r && r.title) || '').trim().slice(0, 120), body: String((r && r.body) || '').trim().slice(0, 4000) }))
    .filter((r) => r.title && r.body)
    .slice(0, 100);
  await query('UPDATE app_settings SET ticket_canned_json = $1::jsonb WHERE id = 1', [JSON.stringify(out)]);
  return out;
}

/** The admin-curated category list (source of truth for the dropdowns). */
async function getManagedCategories() {
  try {
    const { rows } = await query('SELECT ticket_categories_json FROM app_settings WHERE id = 1');
    const raw = rows[0] && Array.isArray(rows[0].ticket_categories_json) ? rows[0].ticket_categories_json : [];
    return raw.map((c) => String(c || '').trim().slice(0, 120)).filter(Boolean);
  } catch { return []; }
}

async function saveManagedCategories(input) {
  const seen = new Set();
  const out = [];
  for (const c of (Array.isArray(input) ? input : [])) {
    const v = String(c || '').trim().slice(0, 120);
    if (v && !seen.has(v.toLowerCase())) { seen.add(v.toLowerCase()); out.push(v); }
  }
  const clipped = out.slice(0, 200);
  await query('UPDATE app_settings SET ticket_categories_json = $1::jsonb WHERE id = 1', [JSON.stringify(clipped)]);
  return clipped;
}

/** Managed list merged with any legacy free-text categories on existing tickets. */
async function categories() {
  const managed = await getManagedCategories();
  const { rows } = await query(
    "SELECT DISTINCT category FROM tickets WHERE category IS NOT NULL AND category <> '' ORDER BY category LIMIT 200"
  );
  const used = rows.map((r) => r.category);
  return [...new Set([...managed, ...used])].sort((a, b) => String(a).localeCompare(String(b)));
}

// Service-desk KPI counts for the stats strip. Breach is computed live (open
// tickets past their resolution target) so it doesn't wait on the scheduler.
async function stats() {
  const { rows } = await query(`
    SELECT
      COUNT(*) FILTER (WHERE status NOT IN ('resolved','closed','cancelled')) AS open,
      COUNT(*) FILTER (WHERE status NOT IN ('resolved','closed','cancelled') AND assignee_user_id IS NULL) AS unassigned,
      COUNT(*) FILTER (WHERE status NOT IN ('resolved','closed','cancelled') AND resolved_at IS NULL
                         AND sla_paused_at IS NULL
                         AND resolve_due_at IS NOT NULL AND resolve_due_at < now()) AS breached,
      COUNT(*) FILTER (WHERE resolved_at >= date_trunc('day', now())) AS resolved_today,
      -- SLA compliance over the last 30 days of resolved tickets (met resolution target)
      COUNT(*) FILTER (WHERE resolved_at >= now() - interval '30 days' AND resolve_due_at IS NOT NULL) AS resolved_measurable,
      COUNT(*) FILTER (WHERE resolved_at >= now() - interval '30 days' AND resolve_due_at IS NOT NULL AND resolved_at <= resolve_due_at) AS resolved_met,
      ROUND(AVG(csat_rating) FILTER (WHERE csat_rating IS NOT NULL), 1) AS csat_avg,
      COUNT(*) FILTER (WHERE csat_rating IS NOT NULL) AS csat_count
    FROM tickets`);
  const r = rows[0] || {};
  const measurable = Number(r.resolved_measurable) || 0;
  return {
    open: Number(r.open) || 0,
    unassigned: Number(r.unassigned) || 0,
    breached: Number(r.breached) || 0,
    resolvedToday: Number(r.resolved_today) || 0,
    slaCompliance: measurable ? Math.round((Number(r.resolved_met) || 0) / measurable * 100) : null,
    csatAvg: r.csat_avg != null ? Number(r.csat_avg) : null,
    csatCount: Number(r.csat_count) || 0,
  };
}

/**
 * ITIL service-desk report over a date window (defaults to the last 30 days):
 * volume, SLA response/resolution compliance + average times, CSAT with its
 * rating distribution, and a per-agent breakdown (workload, SLA, CSAT).
 * Period metrics key off resolved_at (throughput) and created_at (intake).
 */
/**
 * Per-ticket SLA rows for the range — the raw material an SLA review needs.
 *
 * The report's SLA panel gives two compliance percentages, which answer "did we
 * hit target" but never "on what, and by how much". This returns one row per
 * ticket with both clocks laid out beside their targets, so a breach can be
 * traced to a priority, a category, an agent or a requester rather than argued
 * about in the abstract.
 *
 * Scope is the two populations an SLA review actually looks at: everything
 * RESOLVED in the window (what compliance is measured on), plus anything still
 * open that is already BREACHED (what is bleeding right now). The `state` column
 * says which is which, so the two never get silently averaged together.
 */
async function slaDetail({ from, to } = {}) {
  const day = (v, fb) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : fb);
  const toD = day(to, new Date().toISOString().slice(0, 10));
  const fromD = day(from, new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const params = [fromD, `${toD} 23:59:59`];

  const { rows } = await query(`
    SELECT
      t.number, t.type, t.subject, t.category, t.priority, t.impact, t.urgency, t.status,
      CASE WHEN t.resolved_at BETWEEN $1 AND $2 THEN 'resolved' ELSE 'open_breached' END AS state,
      re.full_name  AS "requesterName",
      re.department AS "requesterDepartment",
      COALESCE(re.vip, false) AS "requesterVip",
      co.name       AS "requesterCompany",
      au.username   AS "assigneeName",
      t.created_at AS "createdAt", t.first_response_at AS "firstResponseAt",
      t.resolved_at AS "resolvedAt", t.closed_at AS "closedAt",
      t.response_due_at AS "responseDueAt", t.resolve_due_at AS "resolveDueAt",
      t.sla_paused_at AS "slaPausedAt",
      ROUND(EXTRACT(EPOCH FROM (t.first_response_at - t.created_at))/3600, 2) AS "responseHours",
      ROUND(EXTRACT(EPOCH FROM (t.response_due_at  - t.created_at))/3600, 2) AS "responseTargetHours",
      ROUND(EXTRACT(EPOCH FROM (t.resolved_at      - t.created_at))/3600, 2) AS "resolutionHours",
      ROUND(EXTRACT(EPOCH FROM (t.resolve_due_at   - t.created_at))/3600, 2) AS "resolutionTargetHours",
      -- Minutes over target; negative means finished early. NULL when the clock
      -- never applied, which is not the same as "met" and must stay distinct.
      CASE WHEN t.response_due_at IS NOT NULL AND t.first_response_at IS NOT NULL
           THEN ROUND(EXTRACT(EPOCH FROM (t.first_response_at - t.response_due_at))/60) END AS "responseOverMinutes",
      CASE WHEN t.resolve_due_at IS NOT NULL AND t.resolved_at IS NOT NULL
           THEN ROUND(EXTRACT(EPOCH FROM (t.resolved_at - t.resolve_due_at))/60) END AS "resolutionOverMinutes",
      CASE WHEN t.response_due_at IS NULL OR t.first_response_at IS NULL THEN NULL
           ELSE t.first_response_at <= t.response_due_at END AS "responseMet",
      CASE WHEN t.resolve_due_at IS NULL OR t.resolved_at IS NULL THEN NULL
           ELSE t.resolved_at <= t.resolve_due_at END AS "resolutionMet",
      t.response_breached_at AS "responseBreachedAt",
      t.resolve_breached_at  AS "resolveBreachedAt",
      t.resolution_code AS "resolutionCode", t.csat_rating AS "csatRating"
    FROM tickets t
    LEFT JOIN employees re ON re.id = t.requester_employee_id
    LEFT JOIN companies co ON co.id = re.company_id
    LEFT JOIN users     au ON au.id = t.assignee_user_id
    WHERE t.resolved_at BETWEEN $1 AND $2
       OR (t.status NOT IN ('resolved','closed','cancelled')
           AND (t.resolve_breached_at IS NOT NULL OR t.response_breached_at IS NOT NULL)
           AND t.created_at <= $2)
    ORDER BY t.resolve_breached_at IS NULL, t.resolved_at DESC NULLS FIRST, t.created_at DESC
    LIMIT 5000`, params);

  return { from: fromD, to: toD, rows };
}

async function report({ from, to } = {}) {
  const day = (v, fb) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : fb);
  const toD = day(to, new Date().toISOString().slice(0, 10));
  const fromD = day(from, new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  // Inclusive of the whole `to` day.
  const params = [fromD, `${toD} 23:59:59`];
  const inRes = 'resolved_at BETWEEN $1 AND $2';
  const { rows: sumRows } = await query(`
    SELECT
      COUNT(*) FILTER (WHERE created_at BETWEEN $1 AND $2) AS opened,
      COUNT(*) FILTER (WHERE created_at BETWEEN $1 AND $2 AND type='incident') AS opened_incidents,
      COUNT(*) FILTER (WHERE created_at BETWEEN $1 AND $2 AND type='request') AS opened_requests,
      COUNT(*) FILTER (WHERE ${inRes}) AS resolved,
      COUNT(*) FILTER (WHERE closed_at BETWEEN $1 AND $2) AS closed,
      COUNT(*) FILTER (WHERE ${inRes} AND resolve_due_at IS NOT NULL) AS res_measurable,
      COUNT(*) FILTER (WHERE ${inRes} AND resolve_due_at IS NOT NULL AND resolved_at <= resolve_due_at) AS res_met,
      COUNT(*) FILTER (WHERE first_response_at BETWEEN $1 AND $2 AND response_due_at IS NOT NULL) AS resp_measurable,
      COUNT(*) FILTER (WHERE first_response_at BETWEEN $1 AND $2 AND response_due_at IS NOT NULL AND first_response_at <= response_due_at) AS resp_met,
      ROUND(AVG(EXTRACT(EPOCH FROM (resolved_at - created_at))/3600) FILTER (WHERE ${inRes}), 1) AS avg_resolution_h,
      ROUND(AVG(EXTRACT(EPOCH FROM (first_response_at - created_at))/3600) FILTER (WHERE first_response_at BETWEEN $1 AND $2), 1) AS avg_response_h,
      ROUND(AVG(csat_rating) FILTER (WHERE csat_rating IS NOT NULL AND ${inRes}), 2) AS csat_avg,
      COUNT(*) FILTER (WHERE csat_rating IS NOT NULL AND ${inRes}) AS csat_count
    FROM tickets`, params);
  const s = sumRows[0] || {};
  const pct = (met, meas) => (Number(meas) ? Math.round((Number(met) || 0) / Number(meas) * 100) : null);

  const { rows: csatDist } = await query(
    `SELECT csat_rating AS rating, COUNT(*)::int AS n FROM tickets
      WHERE csat_rating IS NOT NULL AND ${inRes} GROUP BY csat_rating ORDER BY csat_rating`, params);

  const { rows: agents } = await query(`
    SELECT au.id AS user_id, au.username AS agent,
      COUNT(*)::int AS resolved,
      COUNT(*) FILTER (WHERE t.closed_at BETWEEN $1 AND $2)::int AS closed,
      ROUND(AVG(EXTRACT(EPOCH FROM (t.resolved_at - t.created_at))/3600), 1) AS avg_resolution_h,
      COUNT(*) FILTER (WHERE t.resolve_due_at IS NOT NULL)::int AS sla_measurable,
      COUNT(*) FILTER (WHERE t.resolve_due_at IS NOT NULL AND t.resolved_at <= t.resolve_due_at)::int AS sla_met,
      ROUND(AVG(t.csat_rating) FILTER (WHERE t.csat_rating IS NOT NULL), 2) AS csat_avg
    FROM tickets t JOIN users au ON au.id = t.assignee_user_id
    WHERE t.${inRes} GROUP BY au.id, au.username ORDER BY resolved DESC, agent`, params);

  // Daily trend (opened vs resolved) for a line/bar chart. Uses ::date so the
  // whole `to` day is included. Capped implicitly by the requested range.
  const dParams = [fromD, toD];
  const { rows: trend } = await query(`
    SELECT to_char(gs::date,'YYYY-MM-DD') AS date,
      COALESCE(o.n,0)::int AS opened, COALESCE(r.n,0)::int AS resolved
    FROM generate_series($1::date, $2::date, '1 day') gs
    LEFT JOIN (SELECT created_at::date d, COUNT(*) n FROM tickets WHERE created_at::date BETWEEN $1 AND $2 GROUP BY 1) o ON o.d = gs::date
    LEFT JOIN (SELECT resolved_at::date d, COUNT(*) n FROM tickets WHERE resolved_at::date BETWEEN $1 AND $2 GROUP BY 1) r ON r.d = gs::date
    ORDER BY gs`, dParams);

  const { rows: byPriority } = await query(
    `SELECT priority, COUNT(*)::int AS n FROM tickets WHERE created_at::date BETWEEN $1 AND $2 GROUP BY priority`, dParams);
  const { rows: byCategory } = await query(
    `SELECT COALESCE(NULLIF(category,''),'—') AS category, COUNT(*)::int AS n
       FROM tickets WHERE created_at::date BETWEEN $1 AND $2 GROUP BY 1 ORDER BY n DESC LIMIT 8`, dParams);

  const PRIO_ORDER = ['urgent', 'high', 'medium', 'low'];
  return {
    from: fromD,
    to: toD,
    trend,
    byPriority: PRIO_ORDER.map((p) => ({ priority: p, n: (byPriority.find((x) => x.priority === p) || {}).n || 0 })),
    byCategory: byCategory.map((c) => ({ category: c.category, n: c.n })),
    volume: {
      opened: Number(s.opened) || 0,
      openedIncidents: Number(s.opened_incidents) || 0,
      openedRequests: Number(s.opened_requests) || 0,
      resolved: Number(s.resolved) || 0,
      closed: Number(s.closed) || 0,
    },
    sla: {
      responseCompliance: pct(s.resp_met, s.resp_measurable),
      resolutionCompliance: pct(s.res_met, s.res_measurable),
      avgResponseHours: s.avg_response_h != null ? Number(s.avg_response_h) : null,
      avgResolutionHours: s.avg_resolution_h != null ? Number(s.avg_resolution_h) : null,
    },
    csat: {
      avg: s.csat_avg != null ? Number(s.csat_avg) : null,
      count: Number(s.csat_count) || 0,
      distribution: [1, 2, 3, 4, 5].map((r) => ({ rating: r, n: (csatDist.find((d) => d.rating === r) || {}).n || 0 })),
    },
    agents: agents.map((a) => ({
      userId: a.user_id,
      agent: a.agent,
      resolved: a.resolved,
      closed: a.closed,
      avgResolutionHours: a.avg_resolution_h != null ? Number(a.avg_resolution_h) : null,
      slaCompliance: pct(a.sla_met, a.sla_measurable),
      csatAvg: a.csat_avg != null ? Number(a.csat_avg) : null,
    })),
  };
}

/**
 * Per-agent drill-down for the report: the tickets they resolved/closed in the
 * window (with resolution time, SLA, CSAT) plus the ones still open on them now.
 */
async function agentReport({ userId, from, to } = {}) {
  if (!isUuid(userId)) throw HttpError.badRequest('Invalid agent');
  const day = (v, fb) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : fb);
  const toD = day(to, new Date().toISOString().slice(0, 10));
  const fromD = day(from, new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const params = [userId, fromD, `${toD} 23:59:59`];
  const cols = `t.id, t.number, t.subject, t.type, t.priority, t.status, t.category,
    t.resolved_at AS "resolvedAt", t.closed_at AS "closedAt", t.csat_rating AS "csatRating",
    ROUND(EXTRACT(EPOCH FROM (t.resolved_at - t.created_at))/3600, 1) AS "resolutionHours",
    (t.resolve_due_at IS NOT NULL AND t.resolved_at <= t.resolve_due_at) AS "slaMet"`;
  const { rows: agentRow } = await query('SELECT username FROM users WHERE id = $1', [userId]);
  const { rows: resolved } = await query(
    `SELECT ${cols} FROM tickets t WHERE t.assignee_user_id = $1 AND t.resolved_at BETWEEN $2 AND $3
      ORDER BY t.resolved_at DESC LIMIT 300`, params);
  const { rows: open } = await query(
    `SELECT t.id, t.number, t.subject, t.type, t.priority, t.status, t.category,
       t.resolve_due_at AS "resolveDueAt", t.created_at AS "createdAt"
       FROM tickets t WHERE t.assignee_user_id = $1
        AND t.status NOT IN ('resolved','closed','cancelled')
      ORDER BY t.created_at ASC LIMIT 300`, [userId]);
  return {
    agent: agentRow[0] ? agentRow[0].username : '—',
    from: fromD, to: toD,
    resolved, // columns are already aliased to camelCase in the SELECT
    open,
  };
}

async function updateTicket(id, patch, user) {
  if (!isUuid(id)) throw HttpError.notFound('Ticket not found');
  const a = actor(user);
  // `assign` is a distinct IAM action from `update`; the PATCH route only gates
  // on `update`, so enforce assign here whenever the patch touches the assignee.
  if (patch.assigneeUserId !== undefined) {
    const canAssign = await require('./permissionService').hasResourceAction(user, 'ticket', 'assign');
    if (!canAssign) throw HttpError.forbidden('You do not have permission to (re)assign tickets');
  }
  // Linking an incident to a problem changes the problem's incident set → gate on problem:update.
  if (patch.problemId !== undefined) {
    const canProblem = await require('./permissionService').hasResourceAction(user, 'problem', 'update');
    if (!canProblem) throw HttpError.forbidden('You do not have permission to link tickets to a problem');
  }
  const slaTargets = await getSlaConfig(); // read before the tx (separate connection)
  const workflow = await getWorkflow();    // effective (editable) status transition map
  let plan = null;
  let cascade = null;
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

    // ITIL prioritization: Impact × Urgency drives priority. Changing either
    // re-derives the priority; an explicit priority still works when impact/
    // urgency aren't both set.
    let effImpact = cur.impact;
    let effUrgency = cur.urgency;
    let iuChanged = false;
    // Single source of truth for resolve_due_at across the priority re-target and
    // the SLA-pause resume, so it's written at most once (no duplicate-column SQL).
    let resolveDueNext;
    if (patch.impact !== undefined) {
      if (patch.impact !== null && !LEVELS.has(patch.impact)) throw HttpError.badRequest('Invalid impact');
      if (String(patch.impact || '') !== String(cur.impact || '')) { set('impact', patch.impact || null); effImpact = patch.impact || null; iuChanged = true; }
    }
    if (patch.urgency !== undefined) {
      if (patch.urgency !== null && !LEVELS.has(patch.urgency)) throw HttpError.badRequest('Invalid urgency');
      if (String(patch.urgency || '') !== String(cur.urgency || '')) { set('urgency', patch.urgency || null); effUrgency = patch.urgency || null; iuChanged = true; }
    }
    let newPriority;
    if (iuChanged && effImpact && effUrgency) newPriority = derivePriority(effImpact, effUrgency);
    else if (patch.priority !== undefined) {
      if (!PRIORITIES.has(patch.priority)) throw HttpError.badRequest('Invalid priority');
      newPriority = patch.priority;
    }
    if (newPriority !== undefined && newPriority !== cur.priority) {
      set('priority', newPriority);
      acts.push(['priority', `${cur.priority} → ${newPriority}`]);
      // Re-target the SLA clocks that haven't completed yet (relative to creation).
      // Clear the matching breach marker too, so the sweep can re-flag against the
      // new deadline (its guard is `<col> IS NULL`) and log it once for that target.
      const due = slaDueDates(slaTargets, newPriority, cur.created_at);
      if (!cur.first_response_at) { set('response_due_at', due.responseDueAt); set('response_breached_at', null); }
      if (!cur.resolved_at) { resolveDueNext = due.resolveDueAt; set('resolve_breached_at', null); }
    }
    if (patch.category !== undefined) set('category', patch.category ? String(patch.category).trim().slice(0, 120) : null);
    if (patch.resolutionCode !== undefined) {
      if (patch.resolutionCode && !RESOLUTION_CODES.has(patch.resolutionCode)) throw HttpError.badRequest('Invalid resolutionCode');
      set('resolution_code', patch.resolutionCode || null);
    }
    if (patch.resolutionNote !== undefined) set('resolution_note', patch.resolutionNote ? String(patch.resolutionNote).trim().slice(0, 8000) : null);
    if (patch.assetId !== undefined) {
      const next = patch.assetId || null;
      if (next && !isUuid(next)) throw HttpError.badRequest('Invalid assetId');
      if (String(next || '') !== String(cur.asset_id || '')) {
        set('asset_id', next);
        acts.push(['asset', next ? 'linked' : 'unlinked']);
      }
    }
    if (patch.problemId !== undefined) {
      const next = patch.problemId || null;
      if (next && !isUuid(next)) throw HttpError.badRequest('Invalid problemId');
      if (String(next || '') !== String(cur.problem_id || '')) {
        set('problem_id', next);
        acts.push(['problem', next ? 'linked to problem' : 'unlinked from problem']);
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
        const allowed = workflow.transitions[cur.status] || [];
        if (!allowed.includes(patch.status)) {
          throw HttpError.badRequest(`Cannot move a ticket from "${cur.status}" to "${patch.status}"`);
        }
        // Before a ticket can be resolved or closed it must be classified and
        // owned: impact, category and an assignee are all required (cancelling
        // still needs none of them). Any of these may be set in this same PATCH.
        if (patch.status === 'resolved' || patch.status === 'closed') {
          const effAssignee = patch.assigneeUserId !== undefined ? (patch.assigneeUserId || null) : cur.assignee_user_id;
          const effImpactReq = patch.impact !== undefined ? (patch.impact || null) : cur.impact;
          const effCategory = patch.category !== undefined ? (String(patch.category || '').trim() || null) : (cur.category || null);
          const missing = [];
          if (!effImpactReq) missing.push('impact');
          if (!effCategory) missing.push('category');
          if (!effAssignee) missing.push('assignee');
          if (missing.length) {
            throw HttpError.badRequest(`Set ${missing.join(', ')} before resolving or closing the ticket`, { code: 'ticket_required_fields', fields: missing });
          }
        }
        set('status', patch.status);
        acts.push(['status', `${cur.status} → ${patch.status}`]);
        statusTo = patch.status;
        if (patch.status === 'resolved') set('resolved_at', new Date());
        else if (patch.status === 'closed') set('closed_at', new Date());
        else if (['open', 'in_progress'].includes(patch.status)) {
          set('resolved_at', null); set('closed_at', null);
          // Reopening voids the resolution, and with it the rating link that was
          // mailed out for it: there is nothing to rate any more, and the link's
          // expiry is measured from a resolution time that has just been erased.
          // A new one is minted if the ticket is resolved again.
          set('csat_token', null);
        }

        // SLA clock-stop: pause the resolution clock while 'pending' (waiting on
        // the requester). On ANY non-cancelled exit (resume to open/in_progress,
        // or pending→resolved) credit the paused span back — onto the priority-
        // re-targeted due date if one was computed this same PATCH.
        if (patch.status === 'pending' && !cur.resolved_at && !cur.sla_paused_at) {
          set('sla_paused_at', new Date());
        } else if (cur.status === 'pending' && cur.sla_paused_at) {
          if (patch.status !== 'cancelled' && cur.resolve_due_at && !cur.resolved_at) {
            const base = resolveDueNext !== undefined ? resolveDueNext : new Date(cur.resolve_due_at);
            const pausedMs = Date.now() - new Date(cur.sla_paused_at).getTime();
            resolveDueNext = new Date(new Date(base).getTime() + pausedMs);
          }
          set('sla_paused_at', null); // cleared on resume and on terminal exits
        }
      }
    }
    if (resolveDueNext !== undefined) set('resolve_due_at', resolveDueNext);
    if (!sets.length) return;

    set('updated_at', new Date());
    vals.push(id);
    await t.query(`UPDATE tickets SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals);
    for (const [action, detail] of acts) {
      await t.query('INSERT INTO ticket_activity (ticket_id, actor_name, action, detail) VALUES ($1,$2,$3,$4)', [id, a.name, action, detail]);
    }
    audit('ticket.update', `Updated ${cur.number}`, a, id, cur.number);
    if (statusTo || newAssigneeId) {
      plan = { id, number: cur.number, subject: cur.subject, actorName: a.name, actorEmail: a.email,
        requesterEmployeeId: cur.requester_employee_id, statusTo, newAssigneeId };
    }
    if (statusTo && TERMINAL.has(statusTo)) {
      cascade = { status: statusTo, number: cur.number };
    }
  });
  if (plan) notifyUpdate(plan);
  // Duplicates follow their master out. Done after the transaction commits so a
  // follower that cannot be updated never rolls back the ticket the operator
  // actually acted on.
  if (cascade) await closeLinked(id, cascade, a);
  return getTicket(id, user);
}

/**
 * Carry a terminal status to the tickets linked to this one.
 *
 * Written straight to the rows rather than routed back through updateTicket, on
 * purpose: the transition map and the "classify before you close" rule are there
 * to hold a PERSON to a workflow, and a follower is not being worked — it is
 * being closed by the same act that closed its master. Making the operator
 * classify four duplicates before they may close the one they solved is exactly
 * the busywork the link is meant to remove.
 *
 * The master's resolution is copied down where a follower has none, so each
 * requester reads why their own ticket ended, and each is notified separately.
 */
async function closeLinked(masterId, { status, number }, a) {
  try {
    const stamp = status === 'closed' ? 'closed_at' : (status === 'resolved' ? 'resolved_at' : null);
    const { rows } = await query(
      `UPDATE tickets t
          SET status = $2,
              ${stamp ? `${stamp} = now(),` : ''}
              sla_paused_at = NULL,
              resolution_code = COALESCE(t.resolution_code, m.resolution_code),
              resolution_note = COALESCE(t.resolution_note, m.resolution_note),
              updated_at = now()
         FROM tickets m
        WHERE t.linked_to_id = $1 AND m.id = $1
          AND t.status NOT IN ('resolved', 'closed', 'cancelled')
        RETURNING t.id, t.number, t.subject, t.requester_employee_id AS "requesterEmployeeId"`,
      [masterId, status]
    );
    for (const child of rows) {
      await logActivity(child.id, a, 'status', `${status} — with ${number}`);
      notifyUpdate({
        id: child.id, number: child.number, subject: child.subject, actorName: a.name, actorEmail: a.email,
        requesterEmployeeId: child.requesterEmployeeId, statusTo: status, newAssigneeId: null,
      });
    }
    if (rows.length) {
      audit('ticket.update', `${rows.map((r) => r.number).join(', ')} ${status} with ${number}`, a, masterId, number);
    }
    return rows;
  } catch (err) {
    // A follower that would not close must not take the master's close with it;
    // it stays open and visible in the link list.
    console.error('[tickets] linked tickets not carried along:', err.message);
    return [];
  }
}

async function addComment(id, body, user, { ownEmployeeId = null } = {}) {
  if (!isUuid(id)) throw HttpError.notFound('Ticket not found');
  const text = String((body && body.body) || '').trim().slice(0, 8000);
  if (!text) throw HttpError.badRequest('A comment body is required');
  // Employees (portal) can never post restricted notes. staff_only implies internal.
  const staffOnly = !ownEmployeeId && !!(body && body.staffOnly);
  const internal = !ownEmployeeId && (staffOnly || !!(body && body.internal));
  const a = actor(user);
  // Ownership check for self-service authors.
  await getTicket(id, user, { ownEmployeeId });
  const ins = await query(
    'INSERT INTO ticket_comments (ticket_id, author_user_id, author_name, body, internal, staff_only) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
    [id, a.id, a.name, text, internal, staffOnly]
  );
  const commentId = ins.rows[0].id;
  // First customer-facing staff reply stamps the response time. Internal notes
  // are hidden from the requester, so they must not satisfy the response SLA.
  if (!ownEmployeeId && !internal) {
    await query('UPDATE tickets SET first_response_at = COALESCE(first_response_at, now()), updated_at = now() WHERE id = $1', [id]);
  }
  notifyComment({
    id, ownEmployeeId, internal, snippet: text.slice(0, 200), body: text,
    actorName: a.name, actorEmail: a.email,
    // The client posts the comment first and uploads its files afterwards (it
    // needs the comment's id to link them to). So at this moment the comment has
    // no attachments yet, and the mail that went out never mentioned them. The
    // count tells the notifier how many to wait for.
    attachmentCount: Math.min(10, Math.max(0, Number(body && body.attachmentCount) || 0)),
  });
  const ticket = await getTicket(id, user, { ownEmployeeId });
  ticket.newCommentId = commentId; // lets the client link freshly-uploaded files
  return ticket;
}

/* -------------------------- self-service (Portal) -------------------------- */

async function createMyTicket(body, user) {
  const emp = await employeeForUser(user);
  if (!emp) throw HttpError.forbidden('No employee record is linked to your account');
  // createTicket resolves the optional template (type=request + category) and
  // opens its amount-gated approval chain, routed from this employee.
  const ticket = await createTicket({
    type: body && body.type,
    templateId: body && body.templateId,
    subject: body && body.subject,
    description: body && body.description,
    amount: body && body.amount,
  }, user, { asEmployee: emp, source: 'portal' });
  return getMyTicket(ticket.id, user);
}

/**
 * Manually route a ticket to approval — an agent decides it needs sign-off from
 * the requester's manager (or skip-level / department). Creates a ticket_request
 * approval and links it. Fails if one is already pending or nothing resolves.
 */
async function sendToApproval(ticketId, { level = 'manager' } = {}, user) {
  const tk = await getTicket(ticketId, user);
  if (tk.approvalStatus === 'pending') throw HttpError.badRequest('This ticket already has a pending approval');
  if (!tk.requesterEmployeeId) throw HttpError.badRequest('This ticket has no requester to route the approval from');
  // 'emp:<uuid>' names one person directly, for the case the org chart cannot
  // express — a stand-in while a manager is away, a budget owner outside the
  // reporting line. resolveLevel() still refuses an inactive employee, and the
  // requester approving their own ticket, so this widens who may be asked
  // without widening what is allowed.
  let lvl;
  if (typeof level === 'string' && level.startsWith('emp:')) {
    const approverId = level.slice(4);
    if (!isUuid(approverId)) throw HttpError.badRequest('Invalid approver');
    // The org levels are derived from the reporting line, so whoever routes a
    // ticket cannot land it on themselves. Naming an approver by hand can, and
    // decide() only checks that the decider IS the approver — not that they are
    // someone else. Without this an agent holding ticket:update could route a
    // ticket to their own employee row and approve it, clearing a gate that
    // exists to put a second person in the loop.
    const self = await employeeForUser(user);
    if (self && self.id === approverId) {
      throw HttpError.badRequest('Pick someone else — you cannot approve a ticket you routed yourself');
    }
    lvl = level;
  } else {
    lvl = ['manager', 'manager2', 'department'].includes(level) ? level : 'manager';
  }
  const approval = await require('./approvalService').createRequest({
    type: 'ticket_request',
    requesterEmployeeId: tk.requesterEmployeeId,
    requesterName: tk.requesterName,
    payload: { ticketId },
    resourceRef: tk.number,
    summary: `${tk.number}: ${tk.subject}`,
    levels: [lvl],
  });
  if (!approval || !approval.required || !approval.request) {
    throw HttpError.badRequest('Could not start approval — the workflow may be off, or no approver is set for the requester');
  }
  await query('UPDATE tickets SET approval_request_id = $1, updated_at = now() WHERE id = $2', [approval.request.id, ticketId]);
  // Log who was actually asked, not the token — 'emp:<uuid>' says nothing to
  // whoever reads the history later.
  const askedName = approval.request.approverName || lvl;
  await logActivity(ticketId, actor(user), 'approval_requested', `Sent to ${askedName}`).catch(() => {});
  return getTicket(ticketId, user);
}

/** Called by approvalService.dispatch when a service-request approval clears. */
async function onRequestApproved({ ticketId }, actor) {
  if (!isUuid(ticketId)) return;
  await logActivity(ticketId, { name: (actor && actor.name) || 'Approval' }, 'request_approved', 'Approved — ready to fulfil').catch(() => {});
}
/** Called by approvalService on rejection — cancel the held request ticket. */
async function onRequestRejected({ ticketId }, actor) {
  if (!isUuid(ticketId)) return;
  await query("UPDATE tickets SET status='cancelled', updated_at=now() WHERE id = $1 AND status NOT IN ('resolved','closed','cancelled')", [ticketId]);
  await logActivity(ticketId, { name: (actor && actor.name) || 'Approval' }, 'request_rejected', 'Rejected — request cancelled').catch(() => {});
}
/**
 * Cascade a problem closure onto its linked incidents: close the still-open
 * tickets and cancel any pending approval they hold. Called by problemService
 * when a problem moves to 'closed'. Returns how many tickets were closed.
 */
async function closeForProblem(problemId, actorName) {
  if (!isUuid(problemId)) return 0;
  const { rows } = await query(
    "SELECT id, approval_request_id FROM tickets WHERE problem_id = $1 AND status NOT IN ('resolved','closed','cancelled')",
    [problemId]
  );
  if (!rows.length) return 0;
  const ids = rows.map((r) => r.id);
  const arIds = rows.map((r) => r.approval_request_id).filter(Boolean);
  if (arIds.length) {
    await query("UPDATE approval_requests SET status='cancelled', decided_at=now() WHERE id = ANY($1) AND status='pending'", [arIds]);
  }
  await query("UPDATE tickets SET status='closed', closed_at=now(), updated_at=now() WHERE id = ANY($1)", [ids]);
  for (const id of ids) {
    await logActivity(id, { name: actorName || 'System' }, 'closed_by_problem', 'Closed — parent problem resolved').catch(() => {});
  }
  return ids.length;
}

/** Called by approvalService when the requester withdraws — cancel the ticket. */
async function onRequestWithdrawn({ ticketId }, actor) {
  if (!isUuid(ticketId)) return;
  await query("UPDATE tickets SET status='cancelled', updated_at=now() WHERE id = $1 AND status NOT IN ('resolved','closed','cancelled')", [ticketId]);
  await logActivity(ticketId, { name: (actor && actor.name) || 'Requester' }, 'request_withdrawn', 'Withdrawn by requester').catch(() => {});
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

/** Requester CSAT (1-5 + optional comment) on their own resolved/closed ticket. */
async function submitMyCsat(id, body, user) {
  const emp = await employeeForUser(user);
  if (!emp) throw HttpError.forbidden('No employee record is linked to your account');
  await getTicket(id, user, { ownEmployeeId: emp.id }); // ownership gate (throws otherwise)
  const rating = Math.round(Number(body && body.rating));
  if (!(rating >= 1 && rating <= 5)) throw HttpError.badRequest('Rating must be 1-5');
  const { rows } = await query('SELECT status FROM tickets WHERE id = $1', [id]);
  if (!['resolved', 'closed'].includes(rows[0] && rows[0].status)) {
    throw HttpError.badRequest('You can only rate a resolved ticket');
  }
  const comment = body && body.comment ? String(body.comment).trim().slice(0, 4000) : null;
  await query('UPDATE tickets SET csat_rating = $1, csat_comment = $2, csat_at = now() WHERE id = $3', [rating, comment, id]);
  return getMyTicket(id, user);
}

/* ---------------------------- CSAT from the mail ---------------------------- */

/**
 * The bearer token behind the rating links in a resolution email.
 *
 * Minted only when a ticket is resolved and only once, so a ticket that is never
 * resolved never grows one. It names a single ticket, carries no identity, and
 * is never returned by a read API — the only place it is written is into the
 * mail that goes to the requester.
 */
async function ensureCsatToken(ticketId) {
  const { rows } = await query('SELECT csat_token, csat_at FROM tickets WHERE id = $1', [ticketId]);
  if (!rows[0]) return null;
  // A ticket is rated once, so a second link would only lead to a refusal.
  if (rows[0].csat_at) return null;
  if (rows[0].csat_token) return rows[0].csat_token;
  const token = require('crypto').randomBytes(24).toString('hex');
  const upd = await query(
    'UPDATE tickets SET csat_token = COALESCE(csat_token, $2) WHERE id = $1 RETURNING csat_token',
    [ticketId, token]
  );
  return upd.rows[0] ? upd.rows[0].csat_token : null;
}

/**
 * How long a rating link stays open, and how many times it can be used.
 *
 * Both limits exist because the link is a bearer secret that lives in somebody's
 * mailbox forever. Unbounded, it is a permanent door into one ticket, and a
 * score that can be rewritten years later is not a measurement of anything —
 * the desk would be reading a number that anyone holding an old email can move.
 *
 * So: one rating, and thirty days from the resolution to give it. Nobody rates
 * a month-old ticket usefully, and a spent link is spent.
 */
const CSAT_WINDOW_DAYS = 30;

/** 'ok' | 'rated' | 'expired' | 'not_resolved' — why a link can or cannot be used. */
function csatState(tk) {
  if (!tk) return 'gone';
  if (!['resolved', 'closed'].includes(tk.status)) return 'not_resolved';
  if (tk.csatAt) return 'rated';
  // Fail closed on a missing resolution time. The window is measured from it, so
  // without one there is nothing to age against and the link would never run
  // out — an immortal bearer secret sitting in somebody's mailbox. A live token
  // always has one (reopening a ticket drops the token), so this branch means
  // something is off and the safe answer is "closed".
  const from = tk.resolvedAt ? new Date(tk.resolvedAt).getTime() : 0;
  if (!from || Date.now() - from > CSAT_WINDOW_DAYS * 86400000) return 'expired';
  return 'ok';
}

/** What the public rating page may show. Deliberately thin — no requester, no body. */
async function getByCsatToken(token) {
  const tok = String(token || '').trim();
  if (!tok || tok.length < 16) throw HttpError.notFound('Rating link not found');
  const { rows } = await query(
    `SELECT number, subject, status, resolution_note AS "resolutionNote",
            csat_rating AS "csatRating", csat_comment AS "csatComment",
            csat_at AS "csatAt", resolved_at AS "resolvedAt"
       FROM tickets WHERE csat_token = $1`, [tok]
  );
  if (!rows[0]) throw HttpError.notFound('Rating link not found');
  return { ...rows[0], state: csatState(rows[0]) };
}

/**
 * Record a rating from the emailed link. No session: the token is the authority,
 * which is why the page asks for a click rather than scoring straight from the
 * link — mail scanners follow links, and a rating nobody gave is worse than no
 * rating at all.
 */
async function submitCsatByToken(token, body = {}) {
  const tk = await getByCsatToken(token);
  if (tk.state === 'not_resolved') throw HttpError.badRequest('This ticket is not resolved yet');
  if (tk.state === 'rated') throw HttpError.badRequest('This ticket has already been rated', { code: 'csat_rated' });
  if (tk.state === 'expired') throw HttpError.badRequest('This rating link has expired', { code: 'csat_expired' });
  const rating = Math.round(Number(body.rating));
  if (!(rating >= 1 && rating <= 5)) throw HttpError.badRequest('Rating must be 1-5');
  const comment = body.comment ? String(body.comment).trim().slice(0, 4000) : null;
  // `csat_at IS NULL` in the WHERE, not just the check above: two submissions
  // racing each other would otherwise both pass the read and both write. The
  // first one to reach the row wins and the second finds nothing to update.
  const { rows } = await query(
    `UPDATE tickets SET csat_rating = $2, csat_comment = $3, csat_at = now()
      WHERE csat_token = $1 AND csat_at IS NULL RETURNING id, number`,
    [String(token).trim(), rating, comment]
  );
  if (!rows[0]) throw HttpError.badRequest('This ticket has already been rated', { code: 'csat_rated' });
  await query(
    "INSERT INTO ticket_activity (ticket_id, actor_name, action, detail) VALUES ($1, $2, 'csat', $3)",
    [rows[0].id, 'E-posta', `${rating}/5${comment ? ' · comment left' : ''}`]
  ).catch(() => {});
  return { number: rows[0].number, rating, comment };
}

/**
 * Stamp newly-breached SLA legs (once each) and log them to ticket_activity.
 * Called from the 1-minute scheduler tick. The `<> breached_at IS NULL` guard
 * plus the RETURNING set makes each breach fire exactly one activity row, even
 * across overlapping ticks. Safe to run when the module is off (matches nothing).
 */
async function sweepSlaBreaches() {
  const legs = [
    { col: 'response_breached_at', done: 'first_response_at', due: 'response_due_at', action: 'sla_response', detail: 'First-response SLA breached', label: 'First response', extra: '' },
    // resolution clock is paused while 'pending' → don't flag a breach then
    { col: 'resolve_breached_at', done: 'resolved_at', due: 'resolve_due_at', action: 'sla_resolve', detail: 'Resolution SLA breached', label: 'Resolution', extra: ' AND sla_paused_at IS NULL' },
  ];
  let flagged = 0;
  const breached = new Map(); // dedup escalation to one email per ticket per sweep
  for (const l of legs) {
    const { rows } = await query(
      `UPDATE tickets SET ${l.col} = now()
        WHERE ${l.col} IS NULL AND ${l.done} IS NULL AND ${l.due} IS NOT NULL AND ${l.due} < now()
          AND status NOT IN ('resolved','closed','cancelled')${l.extra}
        RETURNING id, number, subject, priority, assignee_user_id AS "assigneeUserId", ${l.due} AS "dueAt"`
    );
    for (const r of rows) {
      await query(
        'INSERT INTO ticket_activity (ticket_id, actor_name, action, detail) VALUES ($1,$2,$3,$4)',
        [r.id, 'system', l.action, l.detail]
      );
      // Both legs can breach in the same tick. One mail per ticket, naming each.
      const seen = breached.get(r.id);
      if (seen) seen.legs.push(l.label);
      else breached.set(r.id, { ...r, legs: [l.label] });
      flagged += 1;
    }
  }
  for (const tk of breached.values()) escalateBreach(tk); // fire-and-forget notifications
  return flagged;
}

// Auto-escalation: on a fresh SLA breach, notify the assignee — or the ops
// recipients (notify.to) when the ticket is unassigned. Never throws.
/** "2h 15m" from a due timestamp to now; the mail says how late, not just that. */
function overdueSince(dueAt) {
  const due = dueAt ? new Date(dueAt).getTime() : NaN;
  if (!Number.isFinite(due)) return '-';
  const mins = Math.max(0, Math.round((Date.now() - due) / 60000));
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  return [d ? `${d}d` : '', h ? `${h}h` : '', (!d && !h) || m ? `${m}m` : ''].filter(Boolean).join(' ');
}

function escalateBreach(tk) {
  (async () => {
    const svc = require('./notificationService');
    let to = null;
    let assigneeName = null;
    if (tk.assigneeUserId) {
      const r = await query('SELECT email, username FROM users WHERE id = $1', [tk.assigneeUserId]);
      to = (r.rows[0] && r.rows[0].email) || null;
      assigneeName = (r.rows[0] && r.rows[0].username) || null;
    }
    if (!to) {
      const cfg = await svc.getMailConfig();
      to = (cfg.notify && cfg.notify.to && cfg.notify.to.length) ? cfg.notify.to : null;
    }
    if (!to) {
      await note(tk.id, 'SLA breach not escalated: nobody is assigned and no fallback recipient is set');
      return;
    }
    const res = await svc.sendSlaBreachNotification({
      to,
      ticketId: tk.id,
      ticketNumber: tk.number,
      subject: tk.subject,
      slaType: (tk.legs || ['SLA']).join(' + '),
      dueAt: tk.dueAt ? new Date(tk.dueAt).toISOString().replace('T', ' ').slice(0, 16) : '-',
      overdueBy: overdueSince(tk.dueAt),
      priority: tk.priority,
      assigneeName,
    });
    // Recorded AFTER the attempt and from its result. Writing "Notified <x>"
    // before sending logged a delivery that never happened whenever SMTP was
    // unset — the trail claimed the desk had been told when it had not.
    const who = Array.isArray(to) ? to.join(', ') : to;
    await note(tk.id, res && res.skipped
      ? `SLA breach mail not sent (${res.reason}) — would have gone to ${who}`
      : `SLA breach mail sent to ${who}`);
  })().catch(() => {});
}

function note(ticketId, detail) {
  return query(
    "INSERT INTO ticket_activity (ticket_id, actor_name, action, detail) VALUES ($1,'system','escalated',$2)",
    [ticketId, detail]
  ).catch(() => {});
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

/**
 * Nobody is told what they just did themselves.
 *
 * A staff member is often the requester too — they open a ticket for their own
 * laptop, then work it. Without this they get their own reply back as mail, and
 * a mail that quotes you to yourself reads as a bug in the system, because it is.
 */
function isSelf(address, actorEmail) {
  const a = String(address || '').trim().toLowerCase();
  const b = String(actorEmail || '').trim().toLowerCase();
  return !!a && a === b;
}

// Notify after an update (status change → requester; new assignee → assignee).
function notifyUpdate(plan) {
  (async () => {
    const p = await partyEmails({ requesterEmployeeId: plan.requesterEmployeeId, assigneeUserId: plan.newAssigneeId });
    if (isSelf(p.requesterEmail, plan.actorEmail)) p.requesterEmail = null;
    if (isSelf(p.assigneeEmail, plan.actorEmail)) p.assigneeEmail = null;
    // Not every status change is news to the person who wrote in. "In progress",
    // "pending", "closed" are the desk's own bookkeeping — closed usually happens
    // days later, automatically, and says nothing that resolved did not. Mail on
    // every one of them trains people to ignore the desk's mail entirely, which
    // costs exactly when something IS worth reading.
    //
    // Two are worth their inbox: resolved (here is the answer — and the only
    // moment they will rate it) and cancelled (this is not being done, and
    // nobody should be left waiting for it).
    if (plan.statusTo === 'resolved' && p.requesterEmail) {
      const svc = require('./notificationService');
      const token = await ensureCsatToken(plan.id);
      const meta = (await query(
        `SELECT t.resolution_note AS note, re.full_name AS name
           FROM tickets t LEFT JOIN employees re ON re.id = t.requester_employee_id
          WHERE t.id = $1`, [plan.id]
      ).catch(() => ({ rows: [] }))).rows[0] || {};
      svc.sendTicketResolved({
        to: p.requesterEmail, ticketId: plan.id, ticketNumber: plan.number, subject: plan.subject,
        resolutionNote: meta.note, requesterName: meta.name, actorName: plan.actorName, csatToken: token,
      }).catch(() => {});
    } else if (plan.statusTo === 'cancelled' && p.requesterEmail) {
      mail({ to: p.requesterEmail, ticketId: plan.id, ticketNumber: plan.number, subject: plan.subject, event: 'cancelled', actorName: plan.actorName });
    }
    if (plan.newAssigneeId && p.assigneeEmail) {
      mail({ to: p.assigneeEmail, ticketId: plan.id, ticketNumber: plan.number, subject: plan.subject, event: 'assigned to you', actorName: plan.actorName });
    }
    // In-app: the newly-assigned agent gets a bell notification too.
    if (plan.newAssigneeId) {
      require('./inappService').create({
        userId: plan.newAssigneeId, type: 'ticket_assigned',
        title: `${plan.number} ${'assigned to you'}`,
        body: plan.subject, link: '#/tickets',
      }).catch(() => {});
    }
  })().catch(() => {});
}

/**
 * Wait for the files a comment is about to receive.
 *
 * The client cannot upload them before the comment exists — it needs the
 * comment's id to link them — so the reply mail was always composed against a
 * comment with no attachments and went out saying nothing about them. Rather
 * than reshape the upload contract, the mail waits a few seconds for the files
 * the client said were coming, and sends whatever has landed by then.
 *
 * Public files only: an internal or staff-only attachment must never leave with
 * a mail to the requester, whatever it was posted alongside.
 */
async function awaitCommentFiles(ticketId, expected, { timeoutMs = 12000, stepMs = 300 } = {}) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    // Counted over every file that landed, returned as only the public ones:
    // the wait is "has the client finished uploading", which a staff-only file
    // answers just as well as a public one — while sending it would leak it.
    const { rows } = await query(
      `SELECT id, filename, mime, byte_size AS "byteSize",
              (internal = false AND staff_only = false) AS "public"
         FROM ticket_documents
        WHERE ticket_id = $1 AND comment_id IS NOT NULL
          AND created_at > now() - interval '2 minutes'
        ORDER BY created_at ASC`, [ticketId]
    ).catch(() => ({ rows: [] }));
    if (rows.length >= expected || Date.now() >= until) {
      return rows.filter((r) => r.public).map(({ id, filename, mime, byteSize }) => ({ id, filename, mime, byteSize }));
    }
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

// Notify after a comment (staff public reply → requester; employee reply → assignee).
function notifyComment({ id, ownEmployeeId, internal, snippet, body, actorName, actorEmail, attachmentCount = 0 }) {
  if (internal) return; // internal notes never leave the building
  (async () => {
    const meta = (await query(
      'SELECT number, subject, requester_employee_id AS "requesterEmployeeId", assignee_user_id AS "assigneeUserId" FROM tickets WHERE id = $1', [id]
    )).rows[0];
    if (!meta) return;
    const p = await partyEmails(meta);
    if (isSelf(p.requesterEmail, actorEmail)) p.requesterEmail = null;
    if (isSelf(p.assigneeEmail, actorEmail)) p.assigneeEmail = null;
    const inapp = require('./inappService');
    if (!ownEmployeeId) {
      // Staff public reply → email the requester the reply itself (threaded so
      // their answer comes back onto the ticket) + an in-app bell.
      if (p.requesterEmail) {
        const files = attachmentCount ? await awaitCommentFiles(id, attachmentCount) : [];
        try {
          require('./notificationService').sendTicketReply({
            to: p.requesterEmail, ticketId: id, ticketNumber: meta.number, subject: meta.subject,
            replyText: body || snippet || '', actorName, files,
          }).catch(() => {});
        } catch { /* ignore */ }
      }
      if (meta.requesterEmployeeId) {
        inapp.createForEmployee(meta.requesterEmployeeId, {
          type: 'ticket_reply',
          title: `${meta.number} · ${meta.subject}`,
          body: `${actorName || 'Support'}: ${snippet || ''}`.trim(),
          link: '#/tickets', linkPortal: '#/my-tickets',
        }).catch(() => {});
      }
    } else {
      // Requester reply → notify the assignee (email + in-app bell).
      if (p.assigneeEmail) mail({ to: p.assigneeEmail, ticketId: id, ticketNumber: meta.number, subject: meta.subject, event: 'the requester replied', actorName, snippet });
      if (meta.assigneeUserId) {
        inapp.create({
          userId: meta.assigneeUserId,
          type: 'ticket_reply',
          title: `${meta.number} · ${meta.subject}`,
          body: `${actorName || 'Requester'}: ${snippet || ''}`.trim(),
          link: '#/tickets',
        }).catch(() => {});
      }
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
  createTicket, getTicket, listTickets, updateTicket, addComment, sendToApproval,
  createMyTicket, listMyTickets, getMyTicket, addMyComment, submitMyCsat,
  onRequestApproved, onRequestRejected, onRequestWithdrawn, closeForProblem,
  sweepSlaBreaches, SLA_TARGETS, stats, report, agentReport, slaDetail, getSlaConfig, saveSlaConfig, categories,
  getCannedResponses, saveCannedResponses, getManagedCategories, saveManagedCategories,
  getWorkflow, saveWorkflow, resetWorkflow, sweepAutoCloseResolved,
  ackTarget, linkTickets, unlinkTicket, linkedTickets, duplicateCandidates, markSpam,
  ensureCsatToken, getByCsatToken, submitCsatByToken, CSAT_WINDOW_DAYS,
};
