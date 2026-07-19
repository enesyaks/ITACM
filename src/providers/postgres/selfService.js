/**
 * Self-service portal queries — a logged-in employee's OWN zimmet.
 *
 * The link between a login `users` row and an `employees` row is the email
 * address (both columns are UNIQUE). Portal-role accounts reach this through
 * /api/me/* only; nothing here exposes cost or other confidential fields.
 */
const { query } = require('./pool');

const EMPTY = Object.freeze({
  linked: false,
  employee: null,
  assets: [],
  licenses: [],
  lines: [],
  counts: { assets: 0, licenses: 0, lines: 0 },
});

/**
 * Resolve the employee linked to `user` by email, then return the assets they
 * currently hold, their active license assignments and their mobile lines.
 * Returns a `linked:false` shell when no matching employee exists.
 */
async function getMyZimmet(user) {
  const email = String((user && user.email) || '').trim().toLowerCase();
  // Service actors carry synthetic emails (apikey:<prefix>) — never linked.
  if (!email || email.startsWith('apikey:')) return { ...EMPTY };

  const { rows: emps } = await query(
    `SELECT id, full_name, email, department, title, status
     FROM employees WHERE lower(email) = $1`,
    [email]
  );
  const emp = emps[0];
  if (!emp) return { ...EMPTY };

  const [assetsRes, licRes, lineRes] = await Promise.all([
    query(
      `SELECT id, asset_tag, brand, model, category, serial_number, status, warranty_end_date
       FROM assets WHERE current_employee_id = $1 ORDER BY asset_tag`,
      [emp.id]
    ),
    query(
      `SELECT license_id, software_name, assigned_at
       FROM license_assignments WHERE employee_id = $1 AND revoked_at IS NULL
       ORDER BY assigned_at DESC`,
      [emp.id]
    ),
    query(
      `SELECT id, phone_number, operator, plan, status
       FROM mobile_lines WHERE current_employee_id = $1 ORDER BY phone_number`,
      [emp.id]
    ),
  ]);

  const assets = assetsRes.rows.map((a) => ({
    id: a.id,
    assetTag: a.asset_tag,
    brand: a.brand,
    model: a.model,
    category: a.category,
    serialNumber: a.serial_number,
    status: a.status,
    warrantyEndDate: a.warranty_end_date,
  }));
  const licenses = licRes.rows.map((l) => ({
    licenseId: l.license_id,
    softwareName: l.software_name,
    assignedAt: l.assigned_at,
  }));
  const lines = lineRes.rows.map((m) => ({
    id: m.id,
    phoneNumber: m.phone_number,
    operator: m.operator,
    plan: m.plan,
    status: m.status,
  }));

  return {
    linked: true,
    employee: {
      id: emp.id,
      fullName: emp.full_name,
      email: emp.email,
      department: emp.department,
      title: emp.title,
      status: emp.status,
    },
    assets,
    licenses,
    lines,
    counts: { assets: assets.length, licenses: licenses.length, lines: lines.length },
  };
}

module.exports = { getMyZimmet };
