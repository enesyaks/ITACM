/**
 * HR onboarding / offboarding *requests* — checklist tickets for IT.
 *
 * A ticket is a pure request: creating one never touches the employee
 * directory. Provisioning happens only when IT acknowledges, and it is
 * delegated to onboardingService so the stock-reserving flow stays the single
 * owner of employee creation. Offboard tickets never change employee status —
 * they point IT at the existing offboard checklist.
 */
'use strict';

const { query, withTransaction } = require('./pool');
const { mapRow, isUuid } = require('./rowMapper');
const { HttpError } = require('../../utils/httpError');
const auditService = require('./auditService');
const { toDateString } = require('../../utils/pgDate');

const EQUIPMENT_CATEGORIES = Object.freeze([
  'Laptop', 'Monitor', 'Phone', 'Headset', 'Dock', 'Keyboard', 'Mouse', 'Other',
]);

const CATEGORY_SET = new Set(EQUIPMENT_CATEGORIES);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STAFF_SEE_ALL = new Set(['Owner', 'Admin', 'Helpdesk']);
const MAX_QTY = 99;

function actor(user) {
  return {
    id: (user && (user.uid || user.id)) || null,
    name: (user && (user.username || user.name || user.email)) || '',
    email: (user && user.email) || null,
    role: (user && user.role) || '',
  };
}

function isStaff(user) {
  return STAFF_SEE_ALL.has(actor(user).role);
}

function parseDateOnly(v) {
  if (v == null || v === '') return null;
  const s = String(v).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  // Reject calendar-invalid values like 2026-02-31 that the regex lets through.
  const d = new Date(s + 'T00:00:00Z');
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return null;
  return s;
}

/**
 * Normalize the equipment checklist. Repeated categories are SUMMED rather than
 * dropped, so "Monitor x1" plus "Monitor x2" asks IT for three monitors.
 */
function normalizeItems(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const byCategory = new Map();
  for (const it of list) {
    const category = String((it && (it.category || it.name)) || '').trim();
    if (!CATEGORY_SET.has(category)) {
      throw HttpError.badRequest('Invalid equipment category "' + category + '"');
    }
    let qty = Number((it && it.qty) != null ? it.qty : 1);
    if (!Number.isFinite(qty) || qty < 1) qty = 1;
    qty = Math.floor(qty);
    byCategory.set(category, Math.min(MAX_QTY, (byCategory.get(category) || 0) + qty));
  }
  return Array.from(byCategory, ([category, qty]) => ({ category, qty }));
}

/** Load items for many requests in one round trip (no N+1 per row). */
async function loadItemsFor(requestIds) {
  const ids = (requestIds || []).filter(isUuid);
  if (!ids.length) return new Map();
  const { rows } = await query(
    `SELECT request_id, id, category, qty, created_at
       FROM hr_request_items
      WHERE request_id = ANY($1::uuid[])
      ORDER BY created_at ASC, category ASC`,
    [ids]
  );
  const byRequest = new Map(ids.map((id) => [id, []]));
  for (const r of rows) {
    const list = byRequest.get(r.request_id);
    if (list) list.push({ id: r.id, category: r.category, qty: r.qty, createdAt: r.created_at });
  }
  return byRequest;
}

async function loadItems(requestId) {
  return (await loadItemsFor([requestId])).get(requestId) || [];
}

function mapRequest(row, items) {
  const base = mapRow(row);
  return Object.assign({}, base, {
    eventDate: toDateString(row.event_date),
    items: items || [],
    itemCount: (items || []).length,
  });
}

async function getRequest(id) {
  if (!isUuid(id)) throw HttpError.notFound('HR request ' + id + ' not found');
  const { rows } = await query('SELECT * FROM hr_requests WHERE id = $1', [id]);
  if (!rows[0]) throw HttpError.notFound('HR request ' + id + ' not found');
  return mapRequest(rows[0], await loadItems(id));
}

async function listRequests(opts) {
  opts = opts || {};
  const where = [];
  const params = [];
  if (opts.status) { params.push(String(opts.status)); where.push('status = $' + params.length); }
  if (opts.type) { params.push(String(opts.type)); where.push('type = $' + params.length); }
  if (opts.createdBy) {
    if (!isUuid(opts.createdBy)) return [];
    params.push(opts.createdBy);
    where.push('created_by = $' + params.length);
  }
  params.push(Math.min(Math.max(Number(opts.limit) || 100, 1), 200));
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const { rows } = await query(
    'SELECT * FROM hr_requests ' + whereSql + ' ORDER BY created_at DESC LIMIT $' + params.length,
    params
  );
  const items = await loadItemsFor(rows.map((r) => r.id));
  return rows.map((row) => mapRequest(row, items.get(row.id) || []));
}

/**
 * Pending ticket counters. Pass a createdBy scope so a non-staff caller never
 * learns how much traffic the rest of the organisation generates.
 */
async function pendingCounts(scope) {
  const createdBy = scope && scope.createdBy;
  let rows;
  if (createdBy) {
    if (!isUuid(createdBy)) return { hrOnboardPending: 0, hrOffboardPending: 0 };
    ({ rows } = await query(
      "SELECT type, COUNT(*)::int AS n FROM hr_requests WHERE status = 'pending' AND created_by = $1 GROUP BY type",
      [createdBy]
    ));
  } else {
    ({ rows } = await query(
      "SELECT type, COUNT(*)::int AS n FROM hr_requests WHERE status = 'pending' GROUP BY type"
    ));
  }
  const by = Object.fromEntries(rows.map((r) => [r.type, r.n]));
  return { hrOnboardPending: by.onboard || 0, hrOffboardPending: by.offboard || 0 };
}

async function searchEmployeesForHr(q, limit) {
  const term = String(q || '').trim();
  if (term.length < 2) return [];
  const like = '%' + term.replace(/[\\%_]/g, '\\$&') + '%';
  const { rows } = await query(
    `SELECT id, full_name, email, department, title, status
       FROM employees
      WHERE status = 'Active'
        AND (full_name ILIKE $1 ESCAPE '\\' OR email ILIKE $1 ESCAPE '\\' OR COALESCE(department, '') ILIKE $1 ESCAPE '\\')
      ORDER BY full_name ASC
      LIMIT $2`,
    [like, Math.min(Math.max(Number(limit) || 20, 1), 50)]
  );
  return rows.map((r) => ({
    id: r.id, fullName: r.full_name, email: r.email,
    department: r.department, title: r.title, status: r.status,
  }));
}

/** Best-effort IT notification; the outcome is recorded so nothing fails silently. */
async function notifyRequest(data) {
  try {
    const notificationService = require('./notificationService');
    if (!notificationService.sendHrRequestNotice) return;
    const res = await notificationService.sendHrRequestNotice(data);
    if (res && res.skipped) {
      await query('UPDATE hr_requests SET notify_error = $2 WHERE id = $1',
        [data.id, String(res.reason || 'skipped').slice(0, 500)]);
    } else {
      await query('UPDATE hr_requests SET notified_at = now(), notify_error = NULL WHERE id = $1', [data.id]);
    }
  } catch (err) {
    console.warn('[hr] request notice failed:', err.message);
    await query('UPDATE hr_requests SET notify_error = $2 WHERE id = $1',
      [data.id, String(err.message || 'error').slice(0, 500)]).catch(() => {});
  }
}

function audit(event) {
  return auditService.logEvent(event).catch(() => null);
}

/**
 * Open an onboard ticket. This writes ONLY to hr_requests / hr_request_items —
 * the employee record is created later, by IT, at acknowledge time.
 */
async function createOnboardRequest(body, user) {
  const fullName = String((body && body.fullName) || '').trim().slice(0, 200);
  const email = String((body && body.email) || '').trim().toLowerCase().slice(0, 200);
  const department = String((body && body.department) || '').trim().slice(0, 120);
  const title = String((body && body.title) || '').trim().slice(0, 120);
  const notes = String((body && body.notes) || '').trim().slice(0, 2000);
  const eventDate = parseDateOnly(body && (body.eventDate || body.startDate));
  const items = normalizeItems((body && (body.items || body.equipment)) || []);
  if (!fullName) throw HttpError.badRequest('fullName is required');
  if (!email || !EMAIL_RE.test(email)) throw HttpError.badRequest('Valid email is required');
  if (!eventDate) throw HttpError.badRequest('eventDate (YYYY-MM-DD) is required');
  if (!items.length) throw HttpError.badRequest('Select at least one equipment category');
  const a = actor(user);

  let requestId;
  try {
    requestId = await withTransaction(async (t) => {
      const pending = await t.query(
        "SELECT id FROM hr_requests WHERE type = 'onboard' AND status = 'pending' AND lower(email) = $1 LIMIT 1",
        [email]
      );
      if (pending.rows[0]) throw HttpError.conflict('A pending onboard request already exists for this email');

      // Read-only lookup: an existing record is linked for IT's context, never mutated.
      const existing = await t.query(
        'SELECT id, status FROM employees WHERE lower(email) = $1 LIMIT 1',
        [email]
      );
      const employeeId = existing.rows[0] ? existing.rows[0].id : null;

      const { rows } = await t.query(
        `INSERT INTO hr_requests
           (type, status, employee_id, full_name, email, department, title, event_date, notes, created_by, created_by_name)
         VALUES ('onboard', 'pending', $1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [employeeId, fullName, email, department, title, eventDate, notes, a.id, a.name]
      );
      const id = rows[0].id;
      for (const it of items) {
        await t.query(
          'INSERT INTO hr_request_items (request_id, category, qty) VALUES ($1,$2,$3)',
          [id, it.category, it.qty]
        );
      }
      return id;
    });
  } catch (err) {
    // Only the ticket's own partial unique index means "duplicate request";
    // any other 23505 must surface as itself.
    if (err.code === '23505' && String(err.constraint || '').includes('hr_requests_pending_onboard_email')) {
      throw HttpError.conflict('A pending onboard request already exists for this email');
    }
    throw err;
  }

  const data = await getRequest(requestId);
  await audit({
    action: 'hr.request.create',
    source: 'hr',
    summary: 'HR onboard request for ' + fullName + ' (' + email + ') on ' + eventDate,
    actorId: a.id,
    actorEmail: a.email,
    actorName: a.name,
    entityType: 'hr_request',
    entityId: requestId,
    entityLabel: fullName,
    meta: { type: 'onboard', eventDate, itemCount: items.length, employeeId: data.employeeId || null },
  });
  await notifyRequest(data);
  return getRequest(requestId);
}

/** Open an offboard ticket. Employee status is NOT changed — this is a request. */
async function createOffboardRequest(body, user) {
  const employeeId = body && body.employeeId;
  const notes = String((body && body.notes) || '').trim().slice(0, 2000);
  const eventDate = parseDateOnly(body && (body.eventDate || body.endDate));
  if (!isUuid(employeeId)) throw HttpError.badRequest('employeeId is required');
  if (!eventDate) throw HttpError.badRequest('eventDate (YYYY-MM-DD) is required');
  const a = actor(user);

  let requestId;
  try {
    requestId = await withTransaction(async (t) => {
      const emps = await t.query('SELECT * FROM employees WHERE id = $1 FOR UPDATE', [employeeId]);
      if (!emps.rows[0]) throw HttpError.notFound('Employee not found');
      const emp = emps.rows[0];
      if (emp.status !== 'Active') throw HttpError.conflict(emp.full_name + ' is not Active');
      const pending = await t.query(
        "SELECT id FROM hr_requests WHERE type = 'offboard' AND status = 'pending' AND employee_id = $1 LIMIT 1",
        [employeeId]
      );
      if (pending.rows[0]) throw HttpError.conflict('A pending offboard request already exists for this employee');
      const { rows } = await t.query(
        `INSERT INTO hr_requests
           (type, status, employee_id, full_name, email, department, title, event_date, notes, created_by, created_by_name)
         VALUES ('offboard', 'pending', $1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [emp.id, emp.full_name || '', emp.email || '', emp.department || '', emp.title || '',
          eventDate, notes, a.id, a.name]
      );
      return rows[0].id;
    });
  } catch (err) {
    if (err.code === '23505' && String(err.constraint || '').includes('hr_requests_pending_offboard_emp')) {
      throw HttpError.conflict('A pending offboard request already exists for this employee');
    }
    throw err;
  }

  const data = await getRequest(requestId);
  await audit({
    action: 'hr.request.create',
    source: 'hr',
    summary: 'HR offboard request for ' + (data.fullName || employeeId) + ' effective ' + eventDate,
    actorId: a.id,
    actorEmail: a.email,
    actorName: a.name,
    entityType: 'hr_request',
    entityId: requestId,
    entityLabel: data.fullName || '',
    meta: { type: 'offboard', eventDate, employeeId },
  });
  await notifyRequest(data);
  return getRequest(requestId);
}

/** Atomically claim a pending ticket. Returns the claimed row or throws. */
async function claimPending(id, a) {
  const { rows } = await query(
    `UPDATE hr_requests
        SET status = 'acknowledged', acknowledged_at = now(), acknowledged_by = $2
      WHERE id = $1 AND status = 'pending'
      RETURNING *`,
    [id, a.id]
  );
  if (rows[0]) return rows[0];
  const cur = await query('SELECT id, status FROM hr_requests WHERE id = $1', [id]);
  if (!cur.rows[0]) throw HttpError.notFound('HR request ' + id + ' not found');
  throw HttpError.conflict('Request is already ' + cur.rows[0].status);
}

/** Put a ticket back to pending after provisioning failed. */
async function releaseClaim(id) {
  await query(
    `UPDATE hr_requests
        SET status = 'pending', acknowledged_at = NULL, acknowledged_by = NULL
      WHERE id = $1 AND status = 'acknowledged'`,
    [id]
  ).catch(() => {});
}

/**
 * IT acknowledges a ticket.
 *
 * onboard  → provisions through onboardingService.createOnboarding, which owns
 *            employee creation and refuses to resurrect an Inactive record.
 * offboard → marks the ticket handled and points IT at the offboard checklist;
 *            no employee status changes here.
 */
async function acknowledgeRequest(id, user) {
  if (!isUuid(id)) throw HttpError.notFound('HR request ' + id + ' not found');
  const a = actor(user);
  const claimed = await claimPending(id, a);

  let onboardingId = null;
  if (claimed.type === 'onboard') {
    try {
      const email = String(claimed.email || '').trim().toLowerCase();
      const existing = await query(
        'SELECT id, status, full_name FROM employees WHERE lower(email) = $1 LIMIT 1',
        [email]
      );
      const emp = existing.rows[0];
      if (emp && emp.status !== 'Active') {
        throw HttpError.conflict(
          emp.full_name + ' already exists as an inactive employee. Reactivate the record in Employees '
          + 'first, then acknowledge this request — HR tickets never re-activate people.'
        );
      }
      // createOnboarding wants a YYYY-MM-DD string; claimed.event_date is a pg Date.
      const startDate = toDateString(claimed.event_date);
      const onboardingService = require('./onboardingService');
      const created = await onboardingService.createOnboarding(
        emp
          ? { employeeId: emp.id, startDate }
          : {
            fullName: claimed.full_name,
            email: email,
            department: claimed.department || null,
            title: claimed.title || null,
            startDate,
          },
        user
      );
      onboardingId = created.id;
      await query('UPDATE hr_requests SET onboarding_id = $2 WHERE id = $1', [id, onboardingId]);
    } catch (err) {
      await releaseClaim(id);
      throw err;
    }
  }

  const data = await getRequest(id);
  await audit({
    action: 'hr.request.acknowledge',
    source: 'hr',
    summary: 'Acknowledged HR ' + claimed.type + ' request for ' + (claimed.full_name || id),
    actorId: a.id,
    actorEmail: a.email,
    actorName: a.name,
    entityType: 'hr_request',
    entityId: id,
    entityLabel: claimed.full_name || '',
    meta: { type: claimed.type, onboardingId, employeeId: data.employeeId || null },
  });
  return data;
}

/** Cancel a pending ticket. The requester may cancel their own; IT may cancel any. */
async function cancelRequest(id, user, reason) {
  if (!isUuid(id)) throw HttpError.notFound('HR request ' + id + ' not found');
  const a = actor(user);
  const current = await getRequest(id);
  assertCanSeeRequest(current, user);

  const { rows } = await query(
    `UPDATE hr_requests
        SET status = 'cancelled', cancelled_at = now(), cancelled_by = $2, cancel_reason = $3
      WHERE id = $1 AND status = 'pending'
      RETURNING *`,
    [id, a.id, String(reason || '').trim().slice(0, 500)]
  );
  if (!rows[0]) throw HttpError.conflict('Request is already ' + current.status);

  const data = mapRequest(rows[0], await loadItems(id));
  await audit({
    action: 'hr.request.cancel',
    source: 'hr',
    summary: 'Cancelled HR ' + data.type + ' request for ' + (data.fullName || id),
    actorId: a.id,
    actorEmail: a.email,
    actorName: a.name,
    entityType: 'hr_request',
    entityId: id,
    entityLabel: data.fullName || '',
    meta: { type: data.type, reason: data.cancelReason || '' },
  });
  return data;
}

/**
 * Row scope for list/count queries. Staff see everything; anyone else sees only
 * what they filed. Fail closed: an identity without a user id sees nothing.
 */
function listScopeForUser(user) {
  const a = actor(user);
  if (STAFF_SEE_ALL.has(a.role)) return {};
  if (!a.id) return { createdBy: '00000000-0000-0000-0000-000000000000' };
  return { createdBy: a.id };
}

/** Throw unless this user is allowed to see this particular request. */
function assertCanSeeRequest(request, user) {
  const scope = listScopeForUser(user);
  if (!scope.createdBy) return;
  if (String(request.createdBy || '') !== String(scope.createdBy)) {
    throw HttpError.forbidden('Not allowed to view this request');
  }
}

module.exports = {
  EQUIPMENT_CATEGORIES,
  normalizeItems,
  parseDateOnly,
  toDateString,
  listRequests,
  getRequest,
  pendingCounts,
  createOnboardRequest,
  createOffboardRequest,
  acknowledgeRequest,
  cancelRequest,
  searchEmployeesForHr,
  listScopeForUser,
  assertCanSeeRequest,
  isStaff,
};
