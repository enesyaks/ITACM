/** Mobile line (SIM / phone number) inventory — assignable to employees. */
const { query, withTransaction } = require('./pool');
const { mapRow, mapRows, isUuid } = require('./rowMapper');
const { HttpError } = require('../../utils/httpError');

const STATUSES = ['Active', 'Suspended', 'Cancelled'];

function sanitize(body, { partial = false } = {}) {
  const { phoneNumber, operator, plan, simSerial, monthlyCost, status, notes } = body || {};
  if (!partial && (!phoneNumber || !String(phoneNumber).trim())) {
    throw HttpError.badRequest('phoneNumber is required');
  }
  if (status !== undefined && !STATUSES.includes(status)) {
    throw HttpError.badRequest(`status must be one of: ${STATUSES.join(', ')}`);
  }
  const data = {};
  if (phoneNumber !== undefined) data.phone_number = String(phoneNumber).trim();
  if (operator !== undefined) data.operator = operator ? String(operator).trim() : null;
  if (plan !== undefined) data.plan = plan ? String(plan).trim() : null;
  if (simSerial !== undefined) data.sim_serial = simSerial ? String(simSerial).trim() : null;
  if (monthlyCost !== undefined) {
    const c = monthlyCost === '' || monthlyCost == null ? null : Number(monthlyCost);
    if (c !== null && (!Number.isFinite(c) || c < 0)) throw HttpError.badRequest('monthlyCost must be a positive number');
    data.monthly_cost = c;
  }
  if (status !== undefined) data.status = status;
  if (notes !== undefined) data.notes = notes ? String(notes).trim() : null;
  return data;
}

async function listLines({ status, employeeId, search, limit = 500 } = {}) {
  const where = [];
  const params = [];
  if (status) { params.push(status); where.push(`status = $${params.length}`); }
  if (employeeId) {
    if (!isUuid(employeeId)) return [];
    params.push(employeeId); where.push(`current_employee_id = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    where.push(`(phone_number ILIKE $${params.length} OR operator ILIKE $${params.length}
      OR plan ILIKE $${params.length} OR sim_serial ILIKE $${params.length}
      OR current_employee_name ILIKE $${params.length})`);
  }
  params.push(Math.min(Number(limit) || 500, 5000));
  const { rows } = await query(
    `SELECT * FROM mobile_lines ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY phone_number LIMIT $${params.length}`, params
  );
  return rows.map(mapRow);
}

async function createLine(body) {
  const d = sanitize(body);
  try {
    const { rows } = await query(
      `INSERT INTO mobile_lines (phone_number, operator, plan, sim_serial, monthly_cost, status, notes)
       VALUES ($1,$2,$3,$4,$5,COALESCE($6,'Active'),$7) RETURNING *`,
      [d.phone_number, d.operator || null, d.plan || null, d.sim_serial || null,
       d.monthly_cost ?? null, d.status || null, d.notes || null]
    );
    return mapRow(rows[0]);
  } catch (err) {
    if (err.code === '23505') throw HttpError.conflict(`Line ${d.phone_number} is already registered`);
    throw err;
  }
}

async function updateLine(id, body) {
  if (!isUuid(id)) throw HttpError.notFound('Line not found');
  const d = sanitize(body, { partial: true });
  if (!Object.keys(d).length) throw HttpError.badRequest('No updatable fields provided');
  const cols = Object.keys(d);
  const sets = cols.map((c, i) => `${c} = $${i + 2}`).join(', ');
  try {
    const { rows } = await query(
      `UPDATE mobile_lines SET ${sets}, updated_at = now() WHERE id = $1 RETURNING *`,
      [id, ...cols.map((c) => d[c])]
    );
    if (!rows[0]) throw HttpError.notFound('Line not found');
    return mapRow(rows[0]);
  } catch (err) {
    if (err.code === '23505') throw HttpError.conflict('That phone number is already registered');
    throw err;
  }
}

async function assignLine(id, employeeId, itUser) {
  if (!isUuid(id)) throw HttpError.notFound('Line not found');
  if (!isUuid(employeeId)) throw HttpError.badRequest('A valid employeeId is required');
  return withTransaction(async (t) => {
    const l = await t.query('SELECT * FROM mobile_lines WHERE id = $1 FOR UPDATE', [id]);
    if (!l.rows[0]) throw HttpError.notFound('Line not found');
    if (l.rows[0].current_employee_id) throw HttpError.conflict(`Line ${l.rows[0].phone_number} is already assigned to ${l.rows[0].current_employee_name}`);
    if (l.rows[0].status !== 'Active') throw HttpError.conflict('Only Active lines can be assigned');
    if (l.rows[0].reserved_for_employee_id && l.rows[0].reserved_for_employee_id !== employeeId) {
      throw HttpError.conflict(`Line ${l.rows[0].phone_number} is reserved for another employee onboarding`);
    }
    const e = await t.query('SELECT id, full_name FROM employees WHERE id = $1', [employeeId]);
    if (!e.rows[0]) throw HttpError.notFound('Employee not found');
    const upd = await t.query(
      `UPDATE mobile_lines SET current_employee_id = $2, current_employee_name = $3,
              reserved_for_employee_id = NULL, updated_at = now()
       WHERE id = $1 RETURNING *`,
      [id, employeeId, e.rows[0].full_name]
    );
    const by = itUser && (itUser.uid || itUser.id) || null;
    const byName = (itUser && (itUser.username || itUser.email)) || 'IT';
    await t.query(
      `INSERT INTO mobile_line_history
         (line_id, phone_number, employee_id, employee_name, action_type, notes, changed_by, changed_by_name)
       VALUES ($1,$2,$3,$4,'line_assigned',$5,$6,$7)`,
      [id, l.rows[0].phone_number, employeeId, e.rows[0].full_name,
       [l.rows[0].operator, l.rows[0].plan].filter(Boolean).join(' · ') || '',
       by, byName]
    );
    return mapRow(upd.rows[0]);
  });
}

async function unassignLine(id, itUser) {
  if (!isUuid(id)) throw HttpError.notFound('Line not found');
  return withTransaction(async (t) => {
    const l = await t.query('SELECT * FROM mobile_lines WHERE id = $1 FOR UPDATE', [id]);
    if (!l.rows[0]) throw HttpError.notFound('Line not found');
    const row = l.rows[0];
    if (!row.current_employee_id) throw HttpError.conflict('Line is not assigned');
    const upd = await t.query(
      `UPDATE mobile_lines SET current_employee_id = NULL, current_employee_name = NULL, updated_at = now()
       WHERE id = $1 RETURNING *`, [id]
    );
    const by = itUser && (itUser.uid || itUser.id) || null;
    const byName = (itUser && (itUser.username || itUser.email)) || 'IT';
    await t.query(
      `INSERT INTO mobile_line_history
         (line_id, phone_number, employee_id, employee_name, action_type, notes, changed_by, changed_by_name)
       VALUES ($1,$2,$3,$4,'line_unassigned',$5,$6,$7)`,
      [id, row.phone_number, row.current_employee_id, row.current_employee_name,
       [row.operator, row.plan].filter(Boolean).join(' · ') || '',
       by, byName]
    );
    return mapRow(upd.rows[0]);
  });
}

/** Assign / take-back events for one employee (employee history timeline). */
async function listLineHistoryForEmployee(employeeId, limit = 100) {
  if (!isUuid(employeeId)) return [];
  const { rows } = await query(
    `SELECT * FROM mobile_line_history WHERE employee_id = $1
     ORDER BY "timestamp" DESC LIMIT $2`,
    [employeeId, Math.min(Number(limit) || 100, 500)]
  );
  return mapRows(rows);
}

module.exports = { listLines, createLine, updateLine, assignLine, unassignLine, listLineHistoryForEmployee };
