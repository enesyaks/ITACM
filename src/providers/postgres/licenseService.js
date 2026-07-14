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
  if (!mapped) return null;
  mapped.licenseKey = maskLicenseKey(mapped.licenseKey, privileged);
  return attachLifecycle(mapped);
}

/** Derive lifecycle label from status + expiration (for UI pills / dashboard). */
function attachLifecycle(lic) {
  if (!lic) return lic;
  const status = (lic.status || 'active').toLowerCase();
  if (status === 'cancelled') {
    lic.lifecycle = 'cancelled';
    lic.daysLeft = null;
    return lic;
  }
  const exp = lic.expirationDate ? new Date(lic.expirationDate) : null;
  if (!exp || Number.isNaN(exp.getTime())) {
    lic.lifecycle = 'active';
    lic.daysLeft = null;
    return lic;
  }
  const daysLeft = Math.ceil((exp.getTime() - Date.now()) / 86400000);
  lic.daysLeft = daysLeft;
  if (daysLeft < 0) lic.lifecycle = 'expired';
  else if (daysLeft <= 30) lic.lifecycle = 'expiring';
  else lic.lifecycle = 'active';
  return lic;
}

function assertActiveLicense(lic) {
  if ((lic.status || 'active') === 'cancelled') {
    throw HttpError.conflict(`${lic.software_name || 'License'} is cancelled — renew it before use`);
  }
}

/**
 * Seats consumed = employee zimmet (licenses.used_seats) + devices linked via
 * asset_licenses. Support/appliance licenses are typically device-bound.
 */
async function listLicenses({ limit = 200, privileged = false, includeCancelled = true } = {}) {
  const showCancelled = includeCancelled === true || includeCancelled === 'true'
    || includeCancelled === undefined;
  const { rows } = await query(
    `SELECT l.*,
       p.name AS provider_name,
       c.title AS contract_title,
       c.contract_number AS contract_number,
       COALESCE(al.asset_count, 0)::int AS linked_assets,
       COALESCE(ea.emp_count, 0)::int AS assigned_users,
       (l.used_seats + COALESCE(al.asset_count, 0))::int AS used_seats_total,
       COALESCE(dc.doc_count, 0)::int AS document_count
     FROM licenses l
     LEFT JOIN providers p ON p.id = l.provider_id
     LEFT JOIN contracts c ON c.id = l.contract_id
     LEFT JOIN (
       SELECT license_id, COUNT(*)::int AS asset_count
       FROM asset_licenses GROUP BY license_id
     ) al ON al.license_id = l.id
     LEFT JOIN (
       SELECT license_id, COUNT(*)::int AS emp_count
       FROM license_assignments WHERE revoked_at IS NULL
       GROUP BY license_id
     ) ea ON ea.license_id = l.id
     LEFT JOIN (
       SELECT license_id, COUNT(*)::int AS doc_count
       FROM license_documents GROUP BY license_id
     ) dc ON dc.license_id = l.id
     ${showCancelled ? '' : "WHERE COALESCE(l.status, 'active') <> 'cancelled'"}
     ORDER BY
       CASE WHEN COALESCE(l.status, 'active') = 'cancelled' THEN 1 ELSE 0 END,
       l.expiration_date ASC
     LIMIT $1`,
    [Math.min(Number(limit) || 200, 1000)]
  );
  return rows.map((r) => enrichListRow(r, privileged));
}

function enrichListRow(r, privileged) {
  const mapped = mapLicenseRow(r, privileged);
  if (!mapped) return mapped;
  mapped.linkedAssets = Number(r.linked_assets) || 0;
  mapped.assignedUsers = Number(r.assigned_users) || 0;
  mapped.usedSeats = Number(r.used_seats_total) || 0;
  mapped.documentCount = Number(r.document_count) || 0;
  mapped.providerName = r.provider_name || null;
  mapped.contractTitle = r.contract_title || null;
  mapped.contractNumber = r.contract_number || null;
  if (mapped.purchaseAmount != null) mapped.purchaseAmount = Number(mapped.purchaseAmount);
  delete mapped.usedSeatsTotal;
  delete mapped.assetCount;
  delete mapped.empCount;
  delete mapped.docCount;
  return mapped;
}

async function getLicense(licenseId, { privileged = false } = {}) {
  if (!isUuid(licenseId)) throw HttpError.notFound(`License ${licenseId} not found`);
  const { rows } = await query(
    `SELECT l.*,
       p.name AS provider_name,
       c.title AS contract_title,
       c.contract_number AS contract_number,
       COALESCE(al.asset_count, 0)::int AS linked_assets,
       COALESCE(ea.emp_count, 0)::int AS assigned_users,
       (l.used_seats + COALESCE(al.asset_count, 0))::int AS used_seats_total,
       COALESCE(dc.doc_count, 0)::int AS document_count
     FROM licenses l
     LEFT JOIN providers p ON p.id = l.provider_id
     LEFT JOIN contracts c ON c.id = l.contract_id
     LEFT JOIN (
       SELECT license_id, COUNT(*)::int AS asset_count
       FROM asset_licenses GROUP BY license_id
     ) al ON al.license_id = l.id
     LEFT JOIN (
       SELECT license_id, COUNT(*)::int AS emp_count
       FROM license_assignments WHERE revoked_at IS NULL
       GROUP BY license_id
     ) ea ON ea.license_id = l.id
     LEFT JOIN (
       SELECT license_id, COUNT(*)::int AS doc_count
       FROM license_documents GROUP BY license_id
     ) dc ON dc.license_id = l.id
     WHERE l.id = $1`,
    [licenseId]
  );
  if (!rows[0]) throw HttpError.notFound(`License ${licenseId} not found`);
  return enrichListRow(rows[0], privileged);
}

async function resolvePurchaseFields(body = {}) {
  let providerId = body.providerId === '' || body.providerId == null ? null : body.providerId;
  let contractId = body.contractId === '' || body.contractId == null ? null : body.contractId;
  let vendor = body.vendor != null ? String(body.vendor).trim() : undefined;
  let purchaseType = body.purchaseType === '' || body.purchaseType == null
    ? null : String(body.purchaseType).toLowerCase();
  if (purchaseType && !['contract', 'invoice'].includes(purchaseType)) {
    throw HttpError.badRequest('purchaseType must be contract or invoice');
  }

  if (providerId) {
    if (!isUuid(providerId)) throw HttpError.badRequest('Invalid providerId');
    const { rows } = await query('SELECT id, name FROM providers WHERE id = $1', [providerId]);
    if (!rows[0]) throw HttpError.badRequest('Provider not found');
    if (vendor === undefined || vendor === '') vendor = rows[0].name;
  } else if (body.providerId === null || body.providerId === '') {
    providerId = null;
  }

  if (contractId) {
    if (!isUuid(contractId)) throw HttpError.badRequest('Invalid contractId');
    const { rows } = await query(
      'SELECT id, provider_id, title FROM contracts WHERE id = $1',
      [contractId]
    );
    if (!rows[0]) throw HttpError.badRequest('Contract not found');
    if (providerId && rows[0].provider_id !== providerId) {
      throw HttpError.badRequest('Contract does not belong to the selected provider');
    }
    if (!providerId) {
      providerId = rows[0].provider_id;
      const p = await query('SELECT name FROM providers WHERE id = $1', [providerId]);
      if ((!vendor || vendor === '') && p.rows[0]) vendor = p.rows[0].name;
    }
    if (!purchaseType) purchaseType = 'contract';
  } else if (body.contractId === null || body.contractId === '') {
    contractId = null;
  }

  if (purchaseType === 'invoice' && contractId) {
    // invoice may still reference a master agreement; leave contract if provided
  }

  const invoiceNumber = body.invoiceNumber != null
    ? (String(body.invoiceNumber).trim() || null) : undefined;
  let purchaseDate = undefined;
  if (body.purchaseDate !== undefined) {
    if (!body.purchaseDate) purchaseDate = null;
    else {
      const d = new Date(body.purchaseDate);
      if (Number.isNaN(d.getTime())) throw HttpError.badRequest('Invalid purchaseDate');
      purchaseDate = body.purchaseDate;
    }
  }
  let purchaseAmount = undefined;
  if (body.purchaseAmount !== undefined) {
    if (body.purchaseAmount === null || body.purchaseAmount === '') purchaseAmount = null;
    else {
      const n = Number(body.purchaseAmount);
      if (!Number.isFinite(n) || n < 0) throw HttpError.badRequest('Invalid purchaseAmount');
      purchaseAmount = n;
    }
  }
  const purchaseCurrency = body.purchaseCurrency != null
    ? (String(body.purchaseCurrency).trim().toUpperCase().slice(0, 8) || null)
    : undefined;

  return {
    providerId,
    contractId,
    vendor,
    purchaseType,
    invoiceNumber,
    purchaseDate,
    purchaseAmount,
    purchaseCurrency,
  };
}

async function createLicense(body) {
  const { softwareName, licenseKey, totalSeats, expirationDate } = body || {};
  if (!softwareName || !licenseKey) throw HttpError.badRequest('softwareName and licenseKey are required');
  const seats = Number(totalSeats);
  if (!Number.isInteger(seats) || seats < 1) throw HttpError.badRequest('totalSeats must be a positive integer');
  if (!expirationDate) throw HttpError.badRequest('expirationDate is required');

  const purchase = await resolvePurchaseFields(body);
  const vendor = purchase.vendor != null ? purchase.vendor : (body.vendor || null);

  const { rows } = await query(
    `INSERT INTO licenses (
       software_name, vendor, license_key, total_seats, expiration_date,
       provider_id, contract_id, purchase_type, invoice_number,
       purchase_date, purchase_amount, purchase_currency
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING id`,
    [
      softwareName,
      vendor || null,
      licenseKey,
      seats,
      new Date(expirationDate),
      purchase.providerId,
      purchase.contractId,
      purchase.purchaseType,
      purchase.invoiceNumber ?? null,
      purchase.purchaseDate ?? null,
      purchase.purchaseAmount ?? null,
      purchase.purchaseCurrency ?? null,
    ]
  );
  return getLicense(rows[0].id, { privileged: true });
}

async function updateLicense(licenseId, body = {}) {
  if (!isUuid(licenseId)) throw HttpError.notFound(`License ${licenseId} not found`);
  const { rows: cur } = await query('SELECT * FROM licenses WHERE id = $1', [licenseId]);
  if (!cur[0]) throw HttpError.notFound(`License ${licenseId} not found`);

  const purchase = await resolvePurchaseFields({
    providerId: body.providerId !== undefined ? body.providerId : cur[0].provider_id,
    contractId: body.contractId !== undefined ? body.contractId : cur[0].contract_id,
    purchaseType: body.purchaseType !== undefined ? body.purchaseType : cur[0].purchase_type,
    invoiceNumber: body.invoiceNumber !== undefined ? body.invoiceNumber : cur[0].invoice_number,
    purchaseDate: body.purchaseDate !== undefined ? body.purchaseDate : cur[0].purchase_date,
    purchaseAmount: body.purchaseAmount !== undefined ? body.purchaseAmount : cur[0].purchase_amount,
    purchaseCurrency: body.purchaseCurrency !== undefined ? body.purchaseCurrency : cur[0].purchase_currency,
    vendor: body.vendor !== undefined ? body.vendor : cur[0].vendor,
  });

  const softwareName = body.softwareName != null ? String(body.softwareName).trim() : cur[0].software_name;
  const licenseKey = body.licenseKey != null ? String(body.licenseKey).trim() : cur[0].license_key;
  let totalSeats = cur[0].total_seats;
  if (body.totalSeats !== undefined) {
    totalSeats = Number(body.totalSeats);
    if (!Number.isInteger(totalSeats) || totalSeats < 1) {
      throw HttpError.badRequest('totalSeats must be a positive integer');
    }
    if (totalSeats < cur[0].used_seats) {
      throw HttpError.conflict(`totalSeats cannot be below used seats (${cur[0].used_seats})`);
    }
  }
  let expirationDate = cur[0].expiration_date;
  if (body.expirationDate) {
    expirationDate = new Date(body.expirationDate);
    if (Number.isNaN(expirationDate.getTime())) throw HttpError.badRequest('Invalid expirationDate');
  }

  await query(
    `UPDATE licenses SET
       software_name = $2,
       vendor = $3,
       license_key = $4,
       total_seats = $5,
       expiration_date = $6,
       provider_id = $7,
       contract_id = $8,
       purchase_type = $9,
       invoice_number = $10,
       purchase_date = $11,
       purchase_amount = $12,
       purchase_currency = $13
     WHERE id = $1`,
    [
      licenseId,
      softwareName,
      purchase.vendor != null ? purchase.vendor : cur[0].vendor,
      licenseKey,
      totalSeats,
      expirationDate,
      purchase.providerId,
      purchase.contractId,
      purchase.purchaseType,
      purchase.invoiceNumber !== undefined ? purchase.invoiceNumber : cur[0].invoice_number,
      purchase.purchaseDate !== undefined ? purchase.purchaseDate : cur[0].purchase_date,
      purchase.purchaseAmount !== undefined ? purchase.purchaseAmount : cur[0].purchase_amount,
      purchase.purchaseCurrency !== undefined ? purchase.purchaseCurrency : cur[0].purchase_currency,
    ]
  );
  return getLicense(licenseId, { privileged: true });
}

/** Devices (network appliances etc.) linked to a license pool. */
async function listLinkedAssets(licenseId) {
  if (!isUuid(licenseId)) return [];
  const { rows } = await query(
    `SELECT a.id, a.asset_tag, a.brand, a.model, a.category, a.serial_number,
            a.status, a.location, a.current_employee_name
     FROM asset_licenses al
     JOIN assets a ON a.id = al.asset_id
     WHERE al.license_id = $1
     ORDER BY a.asset_tag ASC
     LIMIT 2000`,
    [licenseId]
  );
  return mapRows(rows);
}

/**
 * Ensure linking one more device (excluding an optional asset being re-synced)
 * would not exceed total_seats. Call inside a transaction that already locks
 * the license row when possible.
 */
async function assertCanLinkAsset(client, licenseId, { excludeAssetId = null } = {}) {
  const q = client && client.query ? client : { query };
  // Lock license row when inside a transaction to prevent seat oversubscribe races.
  const forUpdate = client && client.query ? ' FOR UPDATE' : '';
  const licRes = await q.query(
    `SELECT id, software_name, used_seats, total_seats FROM licenses WHERE id = $1${forUpdate}`,
    [licenseId]
  );
  const lic = licRes.rows[0];
  if (!lic) throw HttpError.notFound(`License ${licenseId} not found`);
  assertActiveLicense(lic);

  const params = [licenseId];
  let sql = 'SELECT COUNT(*)::int AS c FROM asset_licenses WHERE license_id = $1';
  if (excludeAssetId) {
    params.push(excludeAssetId);
    sql += ` AND asset_id <> $${params.length}`;
  }
  const { rows } = await q.query(sql, params);
  const assetCount = rows[0].c;
  const used = lic.used_seats + assetCount;
  if (used >= lic.total_seats) {
    throw HttpError.conflict(
      `${lic.software_name}: no seats left (${used}/${lic.total_seats} used — including linked devices)`
    );
  }
  return lic;
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
    assertActiveLicense(lic);

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

    const assetCnt = await t.query(
      'SELECT COUNT(*)::int AS c FROM asset_licenses WHERE license_id = $1',
      [licenseId]
    );
    const consumed = lic.used_seats + assetCnt.rows[0].c;
    if (consumed >= lic.total_seats) {
      throw HttpError.conflict(
        `${lic.software_name}: no seats left (${consumed}/${lic.total_seats} used — including linked devices)`
      );
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

/**
 * Renew a license pool: set a new expiration (required) and optionally a new
 * key. Reactivates cancelled licenses.
 */
async function renewLicense(licenseId, { expirationDate, licenseKey } = {}, itUser) {
  if (!isUuid(licenseId)) throw HttpError.notFound(`License ${licenseId} not found`);
  if (!expirationDate) throw HttpError.badRequest('expirationDate is required to renew');
  const nextExp = new Date(expirationDate);
  if (Number.isNaN(nextExp.getTime())) throw HttpError.badRequest('Invalid expirationDate');
  if (nextExp.getTime() < Date.now() - 86400000) {
    throw HttpError.badRequest('Renewal expiration must be today or in the future');
  }

  const { rows } = await query(
    `UPDATE licenses SET
       expiration_date = $2,
       license_key = COALESCE($3, license_key),
       status = 'active',
       cancelled_at = NULL,
       cancelled_by = NULL,
       cancelled_note = NULL,
       renewed_at = now(),
       renewed_by = $4
     WHERE id = $1
     RETURNING *`,
    [
      licenseId,
      nextExp,
      licenseKey && String(licenseKey).trim() ? String(licenseKey).trim() : null,
      itUser?.uid || itUser?.email || null,
    ]
  );
  if (!rows[0]) throw HttpError.notFound(`License ${licenseId} not found`);
  return mapLicenseRow(rows[0], true);
}

/**
 * Cancel / retire a license pool (no longer renewed). Hidden from expiry alerts.
 */
async function cancelLicense(licenseId, { note } = {}, itUser) {
  if (!isUuid(licenseId)) throw HttpError.notFound(`License ${licenseId} not found`);

  const { rows: cur } = await query('SELECT * FROM licenses WHERE id = $1', [licenseId]);
  if (!cur[0]) throw HttpError.notFound(`License ${licenseId} not found`);
  if (cur[0].status === 'cancelled') throw HttpError.conflict('License is already cancelled');

  const { rows } = await query(
    `UPDATE licenses SET
       status = 'cancelled',
       cancelled_at = now(),
       cancelled_by = $2,
       cancelled_note = $3
     WHERE id = $1
     RETURNING *`,
    [licenseId, itUser?.uid || itUser?.email || null, note ? String(note).trim().slice(0, 500) : null]
  );
  return mapLicenseRow(rows[0], true);
}

module.exports = {
  listLicenses, getLicense, createLicense, updateLicense, adjustSeats,
  assignLicense, revokeAssignment, listAssignments,
  listLinkedAssets, assertCanLinkAsset, renewLicense, cancelLicense,
  maskLicenseKey, PRIVILEGED_ROLES,
};
