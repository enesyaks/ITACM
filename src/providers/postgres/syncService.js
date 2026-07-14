/**
 * External sync connectors: HR employees, discovery assets, software installs (SAM).
 * Intended for use with API keys (service accounts).
 */
const { query } = require('./pool');
const { HttpError } = require('../../utils/httpError');
const { isUuid } = require('./rowMapper');
const employeeService = require('./employeeService');
const assetService = require('./assetService');
const settingsService = require('./settingsService');

async function syncEmployees(items = []) {
  if (!Array.isArray(items)) throw HttpError.badRequest('items must be an array');
  const result = { created: 0, updated: 0, errors: [] };
  for (let i = 0; i < Math.min(items.length, 2000); i++) {
    const row = items[i] || {};
    try {
      const email = String(row.email || '').trim().toLowerCase();
      const fullName = String(row.fullName || row.name || '').trim();
      if (!email || !fullName) throw new Error('email and fullName required');
      const existing = await query('SELECT id FROM employees WHERE lower(email) = $1', [email]);
      if (existing.rows[0]) {
        await employeeService.updateEmployee(existing.rows[0].id, {
          fullName,
          department: row.department,
          title: row.title,
          status: row.status || 'Active',
        });
        result.updated++;
      } else {
        await employeeService.createEmployee({
          fullName,
          email,
          department: row.department,
          title: row.title,
          status: row.status || 'Active',
          startDate: row.startDate || null,
        });
        result.created++;
      }
    } catch (err) {
      result.errors.push({ index: i, error: err.message || String(err) });
    }
  }
  return result;
}

async function syncAssets(items = [], actor) {
  if (!Array.isArray(items)) throw HttpError.badRequest('items must be an array');
  const settings = await settingsService.getSettings();
  const result = { created: 0, updated: 0, errors: [] };
  for (let i = 0; i < Math.min(items.length, 2000); i++) {
    const row = items[i] || {};
    try {
      const serial = String(row.serialNumber || row.serial || '').trim();
      const assetTag = String(row.assetTag || row.tag || '').trim();
      let id = null;
      if (assetTag) {
        const r = await query('SELECT id FROM assets WHERE asset_tag = $1', [assetTag]);
        id = r.rows[0]?.id || null;
      }
      if (!id && serial) {
        const r = await query('SELECT id FROM assets WHERE serial_number = $1', [serial]);
        id = r.rows[0]?.id || null;
      }
      const payload = {
        brand: row.brand || 'Unknown',
        model: row.model || 'Unknown',
        category: row.category || 'Laptop',
        serialNumber: serial || undefined,
        location: row.location || settings.defaultLocation || settings.locations?.[0],
        status: row.status || 'In Stock',
        specs: row.specs || {},
      };
      if (row.hostname || row.ipAddress || row.mgmtIp) {
        payload.specs = {
          ...payload.specs,
          hostname: row.hostname || undefined,
          ipAddress: row.ipAddress || undefined,
        };
        if (row.mgmtIp) payload.mgmtIp = row.mgmtIp;
      }
      if (id) {
        await assetService.updateAsset(id, payload, actor);
        result.updated++;
      } else {
        await assetService.createAsset({
          ...payload,
          assetTag: assetTag || undefined,
        }, actor);
        result.created++;
      }
    } catch (err) {
      result.errors.push({ index: i, error: err.message || String(err) });
    }
  }
  return result;
}

async function syncSoftwareInstalls(items = []) {
  if (!Array.isArray(items)) throw HttpError.badRequest('items must be an array');
  let upserted = 0;
  const errors = [];
  for (let i = 0; i < Math.min(items.length, 5000); i++) {
    const row = items[i] || {};
    try {
      const softwareName = String(row.softwareName || row.name || '').trim();
      if (!softwareName) throw new Error('softwareName required');
      const hostname = row.hostname ? String(row.hostname).trim() : '';
      const assetTag = row.assetTag ? String(row.assetTag).trim() : '';
      let assetId = null;
      if (assetTag) {
        const r = await query('SELECT id FROM assets WHERE asset_tag = $1', [assetTag]);
        assetId = r.rows[0]?.id || null;
      }
      const dedupeKey = `${assetTag.toLowerCase()}|${hostname.toLowerCase()}|${softwareName.toLowerCase()}`;
      await query(
        `INSERT INTO software_installs (hostname, asset_tag, asset_id, software_name, version, source, dedupe_key, seen_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7, now())
         ON CONFLICT (dedupe_key)
         DO UPDATE SET version = EXCLUDED.version, asset_id = COALESCE(EXCLUDED.asset_id, software_installs.asset_id),
                       seen_at = now(), source = EXCLUDED.source`,
        [
          hostname || null, assetTag || null, assetId, softwareName,
          row.version ? String(row.version).slice(0, 80) : null,
          String(row.source || 'sync').slice(0, 40),
          dedupeKey,
        ]
      );
      upserted++;
    } catch (err) {
      errors.push({ index: i, error: err.message || String(err) });
    }
  }
  return { upserted, errors };
}

async function licenseSamReport(licenseId) {
  if (!isUuid(licenseId)) throw HttpError.notFound('License not found');
  const { rows: licRows } = await query(
    `SELECT id, software_name, total_seats FROM licenses WHERE id = $1`,
    [licenseId]
  );
  if (!licRows[0]) throw HttpError.notFound('License not found');
  const name = licRows[0].software_name;
  const { rows: installs } = await query(
    `SELECT id, hostname, asset_tag AS "assetTag", asset_id AS "assetId",
            software_name AS "softwareName", version, seen_at AS "seenAt"
     FROM software_installs
     WHERE lower(software_name) = lower($1)
     ORDER BY seen_at DESC LIMIT 500`,
    [name]
  );
  const { rows: seatRows } = await query(
    `SELECT COUNT(*)::int AS n FROM license_assignments WHERE license_id = $1 AND revoked_at IS NULL`,
    [licenseId]
  );
  const installed = installs.length;
  const seats = Number(licRows[0].total_seats) || 0;
  return {
    licenseId,
    softwareName: name,
    totalSeats: seats,
    assignedSeats: seatRows[0]?.n || 0,
    installedCount: installed,
    overInstalled: seats > 0 ? installed > seats : false,
    installs,
  };
}

module.exports = {
  syncEmployees, syncAssets, syncSoftwareInstalls, licenseSamReport,
};
