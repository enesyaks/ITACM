/** License service (postgres) — seat allocation is atomic via row locks. */
const { query, withTransaction } = require('./pool');
const { mapRow, mapRows, isUuid } = require('./rowMapper');
const { HttpError } = require('../../utils/httpError');

const PRIVILEGED_ROLES = new Set(['Owner', 'Admin']);

function maskLicenseKey(key, privileged) {
  if (privileged || !key) return key;
  const s = String(key);
  if (s.length <= 4) return '••••';
  return '••••-••••-••••-' + s.slice(-4);
}

function mapLicenseRow(row, privileged) {
  const mapped = mapRow(row);
  if (mapped) mapped.licenseKey = maskLicenseKey(mapped.licenseKey, privileged);
  return mapped;
}

async function listLicenses({ limit = 200, privileged = false } = {}) {
  const { rows } = await query(
    'SELECT * FROM licenses ORDER BY expiration_date ASC LIMIT $1',
    [Math.min(Number(limit) || 200, 1000)]
  );
  return rows.map((r) => mapLicenseRow(r, privileged));
}

async function createLicense({ softwareName, vendor, licenseKey, totalSeats, expirationDate }) {
  if (!softwareName || !licenseKey) throw HttpError.badRequest('softwareName and licenseKey are required');
  const seats = Number(totalSeats);
  if (!Number.isInteger(seats) || seats < 1) throw HttpError.badRequest('totalSeats must be a positive integer');
  if (!expirationDate) throw HttpError.badRequest('expirationDate is required');

  const { rows } = await query(
    `INSERT INTO licenses (software_name, vendor, license_key, total_seats, expiration_date)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [softwareName, vendor || null, licenseKey, seats, new Date(expirationDate)]
  );
  return mapLicenseRow(rows[0], true);
}

async function adjustSeats(licenseId, delta) {
  const change = Number(delta);
  if (!Number.isInteger(change) || change === 0) {
    throw HttpError.badRequest('delta must be a non-zero integer (positive = claim, negative = release)');
  }
  if (!isUuid(licenseId)) throw HttpError.notFound(`License ${licenseId} not found`);

  return withTransaction(async (t) => {
    const { rows } = await t.query('SELECT * FROM licenses WHERE id = $1 FOR UPDATE', [licenseId]);
    const lic = rows[0];
    if (!lic) throw HttpError.notFound(`License ${licenseId} not found`);

    const next = lic.used_seats + change;
    if (next < 0) throw HttpError.conflict(`Cannot release ${-change} seats — only ${lic.used_seats} in use`);
    if (next > lic.total_seats) {
      throw HttpError.conflict(`${lic.software_name}: no seats left (${lic.used_seats}/${lic.total_seats} used)`);
    }

    await t.query('UPDATE licenses SET used_seats = $2 WHERE id = $1', [licenseId, next]);
    return { id: licenseId, softwareName: lic.software_name, usedSeats: next, totalSeats: lic.total_seats };
  });
}

/**
 * Software zimmet: assign one seat of a license to an employee.
 * Transactional — seat count and the assignment row can never diverge.
 */
async function assignLicense(licenseId, employeeId, itUser) {
  if (!isUuid(licenseId)) throw HttpError.notFound(`License ${licenseId} not found`);
  if (!employeeId || !isUuid(employeeId)) throw HttpError.badRequest('A valid employeeId is required');

  return withTransaction(async (t) => {
    const licRes = await t.query('SELECT * FROM licenses WHERE id = $1 FOR UPDATE', [licenseId]);
    const lic = licRes.rows[0];
    if (!lic) throw HttpError.notFound(`License ${licenseId} not found`);

    const empRes = await t.query('SELECT * FROM employees WHERE id = $1', [employeeId]);
    const emp = empRes.rows[0];
    if (!emp) throw HttpError.notFound(`Employee ${employeeId} not found`);
    if (emp.status !== 'Active') {
      throw HttpError.conflict(`Employee ${emp.full_name} is inactive — cannot receive software`);
    }

    const dupe = await t.query(
      `SELECT 1 FROM license_assignments
       WHERE license_id = $1 AND employee_id = $2 AND revoked_at IS NULL`,
      [licenseId, employeeId]
    );
    if (dupe.rows.length) {
      throw HttpError.conflict(`${lic.software_name} is already assigned to ${emp.full_name}`);
    }

    if (lic.used_seats >= lic.total_seats) {
      throw HttpError.conflict(`${lic.software_name}: no seats left (${lic.used_seats}/${lic.total_seats} used)`);
    }

    await t.query('UPDATE licenses SET used_seats = used_seats + 1 WHERE id = $1', [licenseId]);
    const ins = await t.query(
      `INSERT INTO license_assignments
         (license_id, software_name, employee_id, employee_name, assigned_by, assigned_by_name)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [licenseId, lic.software_name, employeeId, emp.full_name, itUser.uid, itUser.username || itUser.email]
    );
    return mapRow(ins.rows[0]);
  });
}

/** Revoke a software assignment (zimmet düşürme) and free the seat. */
async function revokeAssignment(assignmentId, itUser) {
  if (!isUuid(assignmentId)) throw HttpError.notFound(`Assignment ${assignmentId} not found`);

  return withTransaction(async (t) => {
    const res = await t.query('SELECT * FROM license_assignments WHERE id = $1 FOR UPDATE', [assignmentId]);
    const a = res.rows[0];
    if (!a) throw HttpError.notFound(`Assignment ${assignmentId} not found`);
    if (a.revoked_at) throw HttpError.conflict('This assignment is already revoked');

    await t.query(
      'UPDATE license_assignments SET revoked_at = now(), revoked_by = $2 WHERE id = $1',
      [assignmentId, itUser.uid]
    );
    await t.query(
      'UPDATE licenses SET used_seats = GREATEST(used_seats - 1, 0) WHERE id = $1',
      [a.license_id]
    );
    return { id: assignmentId, licenseId: a.license_id, softwareName: a.software_name, employeeName: a.employee_name };
  });
}

/** List assignments filtered by license and/or employee; active only by default. */
async function listAssignments({ licenseId, employeeId, includeRevoked } = {}) {
  const where = [];
  const params = [];
  if (licenseId) {
    if (!isUuid(licenseId)) return [];
    params.push(licenseId); where.push(`license_id = $${params.length}`);
  }
  if (employeeId) {
    if (!isUuid(employeeId)) return [];
    params.push(employeeId); where.push(`employee_id = $${params.length}`);
  }
  if (!(includeRevoked === 'true' || includeRevoked === true)) where.push('revoked_at IS NULL');

  const { rows } = await query(
    `SELECT * FROM license_assignments ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY assigned_at DESC LIMIT 5000`,
    params
  );
  return mapRows(rows);
}

module.exports = {
  listLicenses, createLicense, adjustSeats, assignLicense, revokeAssignment, listAssignments,
  maskLicenseKey, PRIVILEGED_ROLES,
};
