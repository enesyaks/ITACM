/**
 * Organization structure service.
 *
 * Departments are the single source of truth for the company department list:
 * settingsService.getSettings().departments reads names FROM this table, so
 * adding a department here (or via the Product Catalog UI, which now routes to
 * addDepartment) shows up everywhere — employee form, filters and the org chart.
 *
 * Teams belong to a department and have a lead; employees carry a team_id and an
 * optional manager_employee_id override. resolveApprover() walks that hierarchy
 * and is consumed by approvalService (which is otherwise passive).
 */
const { query } = require('./pool');
const { mapRow, mapRows, isUuid } = require('./rowMapper');
const { HttpError } = require('../../utils/httpError');

/* ============================ Departments ============================ */

/** Plain sorted name list — the shape settingsService + the UI dropdowns expect. */
async function listDepartmentNames() {
  const { rows } = await query('SELECT name FROM departments ORDER BY name');
  return rows.map((r) => r.name);
}

async function addDepartment(name) {
  const clean = String(name || '').trim();
  if (!clean || clean.length > 60) throw HttpError.badRequest('Department name is required (max 60 chars)');
  const dup = await query('SELECT 1 FROM departments WHERE lower(name) = lower($1)', [clean]);
  if (dup.rows.length) throw HttpError.badRequest(`Department "${clean}" already exists`);
  await query('INSERT INTO departments (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [clean]);
  return listDepartmentNames();
}

/** Delete by name. Refuses if any team or employee still references it. */
async function removeDepartment(name) {
  const clean = String(name || '').trim();
  const { rows } = await query('SELECT id FROM departments WHERE name = $1', [clean]);
  if (!rows[0]) throw HttpError.notFound(`Department "${clean}" not found`);
  const deptId = rows[0].id;
  const teamCount = await query('SELECT COUNT(*)::int AS n FROM teams WHERE department_id = $1', [deptId]);
  if (teamCount.rows[0].n > 0) {
    throw HttpError.badRequest('Remove or move the teams in this department first');
  }
  const empCount = await query('SELECT COUNT(*)::int AS n FROM employees WHERE department = $1', [clean]);
  if (empCount.rows[0].n > 0) {
    throw HttpError.badRequest(`${empCount.rows[0].n} employee(s) are still in "${clean}" — reassign them first`);
  }
  const total = await query('SELECT COUNT(*)::int AS n FROM departments');
  if (total.rows[0].n <= 1) throw HttpError.badRequest('At least one department must remain');
  await query('DELETE FROM departments WHERE id = $1', [deptId]);
  return listDepartmentNames();
}

async function setDepartmentManager(departmentId, employeeId) {
  if (!isUuid(departmentId)) throw HttpError.notFound('Department not found');
  if (employeeId != null && !isUuid(employeeId)) throw HttpError.badRequest('Invalid employee id');
  const { rowCount } = await query(
    'UPDATE departments SET manager_employee_id = $2 WHERE id = $1',
    [departmentId, employeeId || null]
  );
  if (!rowCount) throw HttpError.notFound('Department not found');
  return getDepartment(departmentId);
}

async function getDepartment(id) {
  const { rows } = await query(
    `SELECT d.*, m.full_name AS manager_name
     FROM departments d LEFT JOIN employees m ON m.id = d.manager_employee_id
     WHERE d.id = $1`, [id]
  );
  return mapRow(rows[0]);
}

/* ============================== Teams =============================== */

async function createTeam({ name, departmentId }) {
  const clean = String(name || '').trim();
  if (!clean || clean.length > 60) throw HttpError.badRequest('Team name is required (max 60 chars)');
  if (!isUuid(departmentId)) throw HttpError.badRequest('A valid department is required');
  const dept = await query('SELECT 1 FROM departments WHERE id = $1', [departmentId]);
  if (!dept.rows.length) throw HttpError.notFound('Department not found');
  const dup = await query(
    'SELECT 1 FROM teams WHERE department_id = $1 AND lower(name) = lower($2)', [departmentId, clean]
  );
  if (dup.rows.length) throw HttpError.badRequest(`Team "${clean}" already exists in this department`);
  const { rows } = await query(
    'INSERT INTO teams (name, department_id) VALUES ($1, $2) RETURNING *', [clean, departmentId]
  );
  return mapRow(rows[0]);
}

async function updateTeam(id, { name, leadEmployeeId }) {
  if (!isUuid(id)) throw HttpError.notFound('Team not found');
  const sets = [];
  const params = [id];
  if (name !== undefined) {
    const clean = String(name || '').trim();
    if (!clean || clean.length > 60) throw HttpError.badRequest('Team name is required (max 60 chars)');
    params.push(clean);
    sets.push(`name = $${params.length}`);
  }
  if (leadEmployeeId !== undefined) {
    if (leadEmployeeId != null && !isUuid(leadEmployeeId)) throw HttpError.badRequest('Invalid employee id');
    params.push(leadEmployeeId || null);
    sets.push(`lead_employee_id = $${params.length}`);
  }
  if (!sets.length) return getTeam(id);
  const { rowCount } = await query(`UPDATE teams SET ${sets.join(', ')} WHERE id = $1`, params);
  if (!rowCount) throw HttpError.notFound('Team not found');
  return getTeam(id);
}

async function getTeam(id) {
  const { rows } = await query(
    `SELECT t.*, l.full_name AS lead_name
     FROM teams t LEFT JOIN employees l ON l.id = t.lead_employee_id
     WHERE t.id = $1`, [id]
  );
  return mapRow(rows[0]);
}

/** Delete a team; its members fall back to team-less (department direct members). */
async function deleteTeam(id) {
  if (!isUuid(id)) throw HttpError.notFound('Team not found');
  const { rowCount } = await query('DELETE FROM teams WHERE id = $1', [id]);
  if (!rowCount) throw HttpError.notFound('Team not found');
  return { success: true };
}

/* ===================== Employee ↔ team membership ==================== */

/** Move an employee into a team (and adopt that team's department), or clear it. */
async function assignEmployeeToTeam(employeeId, teamId) {
  if (!isUuid(employeeId)) throw HttpError.notFound('Employee not found');
  let departmentName;
  if (teamId != null) {
    if (!isUuid(teamId)) throw HttpError.badRequest('Invalid team id');
    const { rows } = await query(
      `SELECT d.name FROM teams t JOIN departments d ON d.id = t.department_id WHERE t.id = $1`,
      [teamId]
    );
    if (!rows[0]) throw HttpError.notFound('Team not found');
    departmentName = rows[0].name;
  }
  const { rowCount } = await query(
    `UPDATE employees
       SET team_id = $2,
           department = COALESCE($3, department)
     WHERE id = $1`,
    [employeeId, teamId || null, departmentName || null]
  );
  if (!rowCount) throw HttpError.notFound('Employee not found');
  return { success: true };
}

/* =============================== Tree =============================== */

/** Full department → team → member tree, plus an "unassigned" bucket. */
async function getOrgTree() {
  const [deptRes, teamRes, empRes] = await Promise.all([
    query(`SELECT d.id, d.name, d.manager_employee_id, m.full_name AS manager_name
           FROM departments d LEFT JOIN employees m ON m.id = d.manager_employee_id
           ORDER BY d.name`),
    query(`SELECT t.id, t.name, t.department_id, t.lead_employee_id, l.full_name AS lead_name
           FROM teams t LEFT JOIN employees l ON l.id = t.lead_employee_id
           ORDER BY t.name`),
    query(`SELECT id, full_name, title, department, team_id, status
           FROM employees WHERE status = 'Active' ORDER BY full_name`),
  ]);

  const person = (r) => ({ id: r.id, fullName: r.full_name, title: r.title });
  const teamsById = new Map();
  const teams = teamRes.rows.map((t) => {
    const node = {
      id: t.id, name: t.name, departmentId: t.department_id,
      lead: t.lead_employee_id ? { id: t.lead_employee_id, fullName: t.lead_name } : null,
      members: [],
    };
    teamsById.set(t.id, node);
    return node;
  });

  const deptByName = new Map();
  const departments = deptRes.rows.map((d) => {
    const node = {
      id: d.id, name: d.name,
      manager: d.manager_employee_id ? { id: d.manager_employee_id, fullName: d.manager_name } : null,
      teams: teams.filter((t) => t.departmentId === d.id),
      directMembers: [],
      memberCount: 0,
    };
    deptByName.set(d.name, node);
    return node;
  });

  const unassigned = [];
  for (const r of empRes.rows) {
    if (r.team_id && teamsById.has(r.team_id)) {
      teamsById.get(r.team_id).members.push(person(r));
    } else if (r.department && deptByName.has(r.department)) {
      deptByName.get(r.department).directMembers.push(person(r));
    } else {
      unassigned.push(person(r));
    }
  }
  for (const d of departments) {
    d.memberCount = d.directMembers.length + d.teams.reduce((n, t) => n + t.members.length, 0);
  }

  return { departments, unassigned };
}

/* ===================== Approver resolution ==================== */

/**
 * Resolve the approver for an employee at a given level.
 *   level 'manager'    → direct-manager override, else team lead
 *   level 'department' → the employee's department manager
 * Never returns the requester themselves (self-approval guard) — returns null so
 * the caller can fall back (e.g. to an Owner).
 */
async function resolveApprover(employeeId, level = 'manager') {
  if (!isUuid(employeeId)) return null;
  const { rows } = await query(
    `SELECT e.id, e.manager_employee_id, e.team_id, e.department,
            t.lead_employee_id, t.department_id
     FROM employees e LEFT JOIN teams t ON t.id = e.team_id
     WHERE e.id = $1`, [employeeId]
  );
  const emp = rows[0];
  if (!emp) return null;

  const nameOf = async (id) => {
    if (!id || id === employeeId) return null;
    const r = await query('SELECT id, full_name FROM employees WHERE id = $1', [id]);
    return r.rows[0] ? { id: r.rows[0].id, fullName: r.rows[0].full_name } : null;
  };

  const departmentApprover = async () => {
    let deptId = emp.department_id;
    if (!deptId && emp.department) {
      const d = await query('SELECT id FROM departments WHERE name = $1', [emp.department]);
      deptId = d.rows[0] && d.rows[0].id;
    }
    if (!deptId) return null;
    const d = await query('SELECT manager_employee_id FROM departments WHERE id = $1', [deptId]);
    return nameOf(d.rows[0] && d.rows[0].manager_employee_id);
  };

  if (level === 'department') return departmentApprover();

  // level === 'manager'
  const direct = await nameOf(emp.manager_employee_id);
  if (direct) return direct;
  const lead = await nameOf(emp.lead_employee_id);
  if (lead) return lead;
  // Requester is the lead (or no lead) → escalate to the department manager.
  return departmentApprover();
}

module.exports = {
  listDepartmentNames,
  addDepartment,
  removeDepartment,
  setDepartmentManager,
  getDepartment,
  createTeam,
  updateTeam,
  getTeam,
  deleteTeam,
  assignEmployeeToTeam,
  getOrgTree,
  resolveApprover,
};
