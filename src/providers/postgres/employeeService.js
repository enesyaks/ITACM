/** Employee service (postgres) — Employee Directory + Handover Employee Selector. */
const { query } = require('./pool');
const { mapRow, mapRows, isUuid } = require('./rowMapper');
const { HttpError } = require('../../utils/httpError');
const authProvider = require('./authProvider');

const STATUSES = ['Active', 'Inactive'];
// Same shape importService uses — employees.email is an identity key, not free text.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Whitelisted Employee Directory sorts (never interpolate raw input). */
const EMP_SORT_SQL = {
  name: ['full_name'],
  department: ['department', 'full_name'],
  assets: ['active_asset_count', 'full_name'],
  status: ['status', 'full_name'],
};

function empOrderBySql(sort, order) {
  const cols = EMP_SORT_SQL[sort] || EMP_SORT_SQL.name;
  const dir = String(order || '').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  return cols.map((c) => `${c} ${dir}`).join(', ');
}

async function listEmployees({ status, department, search, sort, order, limit = 200, offset = 0 } = {}) {
  const where = [];
  const params = [];
  const asList = (v) => (Array.isArray(v) ? v : String(v || '').split(','))
    .map((x) => String(x).trim()).filter(Boolean);

  if (status) {
    const list = asList(status).filter((s) => STATUSES.includes(s));
    if (!list.length) throw HttpError.badRequest('status must be Active or Inactive');
    if (list.length === 1) {
      params.push(list[0]);
      where.push(`status = $${params.length}`);
    } else {
      params.push(list);
      where.push(`status = ANY($${params.length}::text[])`);
    }
  }
  if (department) {
    const list = asList(department);
    if (list.length === 1) {
      params.push(list[0]);
      where.push(`department = $${params.length}`);
    } else if (list.length > 1) {
      params.push(list);
      where.push(`department = ANY($${params.length}::text[])`);
    }
  }
  if (search) {
    params.push(`%${search}%`);
    where.push(
      `(full_name ILIKE $${params.length} OR email ILIKE $${params.length} ` +
      `OR department ILIKE $${params.length} OR title ILIKE $${params.length})`
    );
  }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const totalRes = await query(`SELECT COUNT(*)::int AS n FROM employees ${whereSql}`, [...params]);

  params.push(Math.min(Number(limit) || 200, 10000));
  params.push(Math.max(0, Number(offset) || 0));

  const orderSql = empOrderBySql(sort, order);
  const { rows } = await query(
    `SELECT * FROM employees ${whereSql}
     ORDER BY ${orderSql} LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  const summaryRes = await query(
    `SELECT
       COUNT(*) FILTER (WHERE active_asset_count > 0)::int AS with_assets,
       COUNT(*) FILTER (WHERE status = 'Inactive')::int AS inactive
     FROM employees ${whereSql}`,
    params.slice(0, params.length - 2)
  );
  const summary = summaryRes.rows[0];

  return {
    items: mapRows(rows),
    total: totalRes.rows[0].n,
    summary: {
      withAssets: summary.with_assets,
      inactive: summary.inactive,
      active: totalRes.rows[0].n - summary.inactive,
    },
  };
}

async function getEmployee(id) {
  if (!isUuid(id)) throw HttpError.notFound(`Employee ${id} not found`);
  const { rows } = await query('SELECT * FROM employees WHERE id = $1', [id]);
  if (!rows[0]) throw HttpError.notFound(`Employee ${id} not found`);
  const emp = mapRow(rows[0]);
  const email = String(emp.email || '').trim().toLowerCase();
  if (email) {
    const { rows: portal } = await query(
      `SELECT id FROM users WHERE lower(email) = $1 AND role = 'Portal' LIMIT 1`,
      [email]
    );
    emp.hasPortalAccess = portal.length > 0;
  } else {
    emp.hasPortalAccess = false;
  }
  // Reporting line: manager + direct reports (for the profile + org chart).
  if (emp.managerEmployeeId) {
    const { rows: mgr } = await query('SELECT id, full_name FROM employees WHERE id = $1', [emp.managerEmployeeId]);
    emp.manager = mgr[0] ? { id: mgr[0].id, fullName: mgr[0].full_name } : null;
  } else {
    emp.manager = null;
  }
  // Approval delegate (out-of-office): resolve the name for the profile UI.
  if (emp.approvalDelegateId) {
    const { rows: del } = await query('SELECT id, full_name FROM employees WHERE id = $1', [emp.approvalDelegateId]);
    emp.approvalDelegate = del[0] ? { id: del[0].id, fullName: del[0].full_name } : null;
  } else {
    emp.approvalDelegate = null;
  }
  const { rows: reports } = await query(
    "SELECT id, full_name AS \"fullName\", title, department FROM employees WHERE manager_employee_id = $1 AND status = 'Active' ORDER BY full_name",
    [emp.id]
  );
  emp.directReports = reports;
  return emp;
}

async function createEmployee({ fullName, email, department, title, status = 'Active', startDate = null, managerEmployeeId = null }) {
  if (!fullName || !email) throw HttpError.badRequest('fullName and email are required');
  if (!STATUSES.includes(status)) throw HttpError.badRequest('status must be Active or Inactive');
  const normEmail = String(email).trim().toLowerCase();
  if (!EMAIL_RE.test(normEmail)) throw HttpError.badRequest(`Invalid email "${email}"`);
  let start = null;
  if (startDate != null && startDate !== '') {
    start = String(startDate).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) throw HttpError.badRequest('startDate must be YYYY-MM-DD');
  }
  let managerId = null;
  if (managerEmployeeId) {
    if (!isUuid(managerEmployeeId)) throw HttpError.badRequest('Invalid managerEmployeeId');
    managerId = managerEmployeeId; // a brand-new employee can't create a cycle yet
  }

  try {
    const { rows } = await query(
      `INSERT INTO employees (full_name, email, department, title, status, start_date, manager_employee_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [fullName, normEmail, department || null, title || null, status, start, managerId]
    );
    return mapRow(rows[0]);
  } catch (err) {
    if (err.code === '23505') throw HttpError.conflict(`An employee with email ${email} already exists`);
    throw err;
  }
}


/**
 * Idempotent employee twin for a staff (BT) login, keyed by email.
 * Used so IT users can appear in handover pickers and Zimmetlerim without
 * becoming Portal accounts. Does not call authProvider (avoid require cycles).
 * Returns null for empty / synthetic apikey: emails.
 */
async function ensureEmployeeForEmail({ fullName, email, department = 'IT', title = null }) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized || normalized.startsWith('apikey:')) return null;

  const name = String(fullName || '').trim() || normalized;
  const { rows } = await query(
    `INSERT INTO employees (full_name, email, department, title, status)
     VALUES ($1, $2, $3, $4, 'Active')
     ON CONFLICT (email) DO NOTHING
     RETURNING *`,
    [name, normalized, department || 'IT', title || null]
  );
  if (rows[0]) return mapRow(rows[0]);

  const existing = await query(
    'SELECT * FROM employees WHERE lower(email) = $1 LIMIT 1',
    [normalized]
  );
  return existing.rows[0] ? mapRow(existing.rows[0]) : null;
}

async function updateEmployee(id, body) {
  if (!isUuid(id)) throw HttpError.notFound(`Employee ${id} not found`);

  const colMap = {
    fullName: 'full_name', email: 'email', department: 'department',
    title: 'title', status: 'status', startDate: 'start_date',
    managerEmployeeId: 'manager_employee_id',
    approvalDelegateId: 'approval_delegate_id', approvalDelegateUntil: 'approval_delegate_until',
  };
  const data = {};
  for (const [key, col] of Object.entries(colMap)) {
    if (body[key] !== undefined) data[col] = body[key];
  }
  // Approval delegate (out-of-office): a specific active employee, not self.
  if (data.approval_delegate_id !== undefined) {
    const d = data.approval_delegate_id || null;
    if (d) {
      if (!isUuid(d)) throw HttpError.badRequest('Invalid approvalDelegateId');
      if (d === id) throw HttpError.badRequest('An employee cannot delegate approvals to themselves');
    }
    data.approval_delegate_id = d;
  }
  if (data.approval_delegate_until !== undefined) {
    const u = data.approval_delegate_until;
    if (u === null || u === '') data.approval_delegate_until = null;
    else {
      data.approval_delegate_until = String(u).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data.approval_delegate_until)) throw HttpError.badRequest('approvalDelegateUntil must be YYYY-MM-DD');
    }
  }
  // Manager (reports-to): validate uuid, forbid self, and reject reporting cycles.
  if (data.manager_employee_id !== undefined) {
    const m = data.manager_employee_id || null;
    if (m) {
      if (!isUuid(m)) throw HttpError.badRequest('Invalid managerEmployeeId');
      if (m === id) throw HttpError.badRequest('An employee cannot be their own manager');
      let cursor = m; const seen = new Set([id]);
      while (cursor) {
        if (cursor === id) throw HttpError.badRequest('This would create a reporting cycle');
        if (seen.has(cursor)) break;
        seen.add(cursor);
        const r = await query('SELECT manager_employee_id FROM employees WHERE id = $1', [cursor]);
        cursor = r.rows[0] ? r.rows[0].manager_employee_id : null;
      }
    }
    data.manager_employee_id = m;
  }
  // Email links an employees row to its login (users.email) and is what
  // /api/me/zimmet resolves the caller by. The UNIQUE constraint is byte-exact,
  // so an un-normalized "Ali@corp.com" slips past a stored "ali@corp.com" and
  // creates a second row matching the same lower(email) — which would let a
  // portal user resolve to the wrong employee. Normalize on write.
  if (data.email !== undefined) {
    data.email = String(data.email).trim().toLowerCase();
    if (!EMAIL_RE.test(data.email)) {
      throw HttpError.badRequest(`Invalid email "${data.email}"`);
    }
  }
  if (data.start_date !== undefined) {
    if (data.start_date === null || data.start_date === '') data.start_date = null;
    else {
      data.start_date = String(data.start_date).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data.start_date)) {
        throw HttpError.badRequest('startDate must be YYYY-MM-DD');
      }
    }
  }
  if (data.status && !STATUSES.includes(data.status)) {
    throw HttpError.badRequest('status must be Active or Inactive');
  }
  if (Object.keys(data).length === 0) throw HttpError.badRequest('No updatable fields provided');

  const { rows } = await query('SELECT * FROM employees WHERE id = $1', [id]);
  const current = rows[0];
  if (!current) throw HttpError.notFound(`Employee ${id} not found`);

  // Offboarding guard: assets, mobile lines, license seats, or infra responsibility.
  if (data.status === 'Inactive' && current.active_asset_count > 0) {
    throw HttpError.conflict(
      `${current.full_name} still holds ${current.active_asset_count} asset(s). Return them before deactivating.`
    );
  }
  if (data.status === 'Inactive') {
    const lineRes = await query(
      `SELECT COUNT(*)::int AS n FROM mobile_lines WHERE current_employee_id = $1`,
      [id]
    ).catch(() => ({ rows: [{ n: 0 }] }));
    if (lineRes.rows[0].n > 0) {
      throw HttpError.conflict(
        `${current.full_name} still has ${lineRes.rows[0].n} mobile line(s) assigned. Unassign them first.`
      );
    }
    const licRes = await query(
      `SELECT COUNT(*)::int AS n FROM license_assignments
       WHERE employee_id = $1 AND revoked_at IS NULL`,
      [id]
    );
    if (licRes.rows[0].n > 0) {
      throw HttpError.conflict(
        `${current.full_name} still has ${licRes.rows[0].n} software license seat(s). Revoke them first.`
      );
    }
    const infraRes = await query(
      `SELECT COUNT(*)::int AS n FROM assets
       WHERE responsible_employee_id = $1 AND category IN ('Network', 'Server')`,
      [id]
    );
    if (infraRes.rows[0].n > 0) {
      throw HttpError.conflict(
        `${current.full_name} is still responsible for ${infraRes.rows[0].n} network/server device(s). ` +
        'Reassign or clear responsibility first (use Offboard).'
      );
    }
    const contractRes = await query(
      'SELECT COUNT(*)::int AS n FROM contracts WHERE owner_employee_id = $1',
      [id]
    );
    if (contractRes.rows[0].n > 0) {
      throw HttpError.conflict(
        `${current.full_name} is still internal owner of ${contractRes.rows[0].n} contract(s). ` +
        'Transfer or clear ownership first (use Offboard).'
      );
    }
  }

  const cols = Object.keys(data);
  const sets = cols.map((c, i) => `${c} = $${i + 2}`).join(', ');
  const updated = await query(
    `UPDATE employees SET ${sets} WHERE id = $1 RETURNING *`,
    [id, ...cols.map((c) => data[c])]
  );
  const emp = mapRow(updated.rows[0]);
  // Inactive = offboarded: close Portal web access immediately.
  if (data.status === 'Inactive' && current.status !== 'Inactive') {
    await authProvider.revokePortalAccess({ employee: emp }, null, { soft: true }).catch(() => {});
  }
  return emp;
}

/** Full activity history of one employee: devices + mobile line zimmet events. */
async function getEmployeeHistory(id, limit = 100) {
  if (!isUuid(id)) throw HttpError.notFound(`Employee ${id} not found`);
  const cap = Math.min(Number(limit) || 100, 500);
  const [devices, lines] = await Promise.all([
    query(
      `SELECT id, asset_tag AS label, action_type, notes, changed_by_name, employee_name, "timestamp",
              'device' AS kind
       FROM asset_history WHERE employee_id = $1
       ORDER BY "timestamp" DESC LIMIT $2`,
      [id, cap]
    ),
    query(
      `SELECT id, phone_number AS label, action_type, notes, changed_by_name, employee_name, "timestamp",
              'line' AS kind
       FROM mobile_line_history WHERE employee_id = $1
       ORDER BY "timestamp" DESC LIMIT $2`,
      [id, cap]
    ).catch(() => ({ rows: [] })), // table may not exist until migrate runs
  ]);
  return [...mapRows(devices.rows), ...mapRows(lines.rows)]
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, cap);
}

module.exports = {
  listEmployees, getEmployee, createEmployee, ensureEmployeeForEmail,
  updateEmployee, getEmployeeHistory,
};
