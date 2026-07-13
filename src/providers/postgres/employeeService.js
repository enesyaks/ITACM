/** Employee service (postgres) — Employee Directory + Handover Employee Selector. */
const { query } = require('./pool');
const { mapRow, mapRows, isUuid } = require('./rowMapper');
const { HttpError } = require('../../utils/httpError');

const STATUSES = ['Active', 'Inactive'];

async function listEmployees({ status, department, search, limit = 200, offset = 0 } = {}) {
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

  const { rows } = await query(
    `SELECT * FROM employees ${whereSql}
     ORDER BY full_name LIMIT $${params.length - 1} OFFSET $${params.length}`,
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
  return mapRow(rows[0]);
}

async function createEmployee({ fullName, email, department, title, status = 'Active', startDate = null }) {
  if (!fullName || !email) throw HttpError.badRequest('fullName and email are required');
  if (!STATUSES.includes(status)) throw HttpError.badRequest('status must be Active or Inactive');
  let start = null;
  if (startDate != null && startDate !== '') {
    start = String(startDate).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) throw HttpError.badRequest('startDate must be YYYY-MM-DD');
  }

  try {
    const { rows } = await query(
      `INSERT INTO employees (full_name, email, department, title, status, start_date)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [fullName, email.toLowerCase(), department || null, title || null, status, start]
    );
    return mapRow(rows[0]);
  } catch (err) {
    if (err.code === '23505') throw HttpError.conflict(`An employee with email ${email} already exists`);
    throw err;
  }
}

async function updateEmployee(id, body) {
  if (!isUuid(id)) throw HttpError.notFound(`Employee ${id} not found`);

  const colMap = {
    fullName: 'full_name', email: 'email', department: 'department',
    title: 'title', status: 'status', startDate: 'start_date',
  };
  const data = {};
  for (const [key, col] of Object.entries(colMap)) {
    if (body[key] !== undefined) data[col] = body[key];
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
  }

  const cols = Object.keys(data);
  const sets = cols.map((c, i) => `${c} = $${i + 2}`).join(', ');
  const updated = await query(
    `UPDATE employees SET ${sets} WHERE id = $1 RETURNING *`,
    [id, ...cols.map((c) => data[c])]
  );
  return mapRow(updated.rows[0]);
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

module.exports = { listEmployees, getEmployee, createEmployee, updateEmployee, getEmployeeHistory };
