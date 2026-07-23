/**
 * Stock count (physical inventory) service.
 *
 * A count session collects scans — barcode / QR / manual tag entry — from ANY
 * signed-in device (start on the PC, keep scanning from a phone on the same
 * session). Closing the session compares what was scanned against the live
 * inventory and stores the result: found / missing / unexpected.
 */
const { query, withTransaction } = require('./pool');
const { mapRow, mapRows, isUuid } = require('./rowMapper');
const { HttpError } = require('../../utils/httpError');

/** "ITACPRO|ASSET|IT-1042" (QR) or "IT-1042" (barcode/manual) → the tag. */
function normalizeTag(raw) {
  const s = String(raw || '').trim();
  const m = /^ITACPRO\|ASSET\|(.+)$/i.exec(s);
  return (m ? m[1] : s).trim().toUpperCase();
}

async function createCount({ name, location }, itUser) {
  const title = String(name || '').trim() || `Stock count ${new Date().toISOString().slice(0, 10)}`;
  const { rows } = await query(
    `INSERT INTO stock_counts (name, location, created_by_name)
     VALUES ($1, $2, $3) RETURNING *`,
    [title.slice(0, 80), location || null, itUser.username || itUser.email]
  );
  return mapRow(rows[0]);
}

async function listCounts({ limit = 50 } = {}) {
  const { rows } = await query(
    `SELECT c.*, (SELECT COUNT(*)::int FROM stock_count_scans s WHERE s.count_id = c.id) AS scan_count
     FROM stock_counts c ORDER BY created_at DESC LIMIT $1`,
    [Math.min(Number(limit) || 50, 200)]
  );
  return mapRows(rows);
}

/** Expected set for a count: every non-scrap asset (optionally one location). */
async function expectedAssets(location) {
  const params = [];
  let where = `status <> 'Scrap'`;
  if (location) { params.push(location); where += ` AND location = $1`; }
  const { rows } = await query(
    `SELECT id, asset_tag, brand, model, category, status, location,
            current_employee_name, serial_number
     FROM assets WHERE ${where} ORDER BY asset_tag`, params
  );
  return rows;
}

/** Snapshot fields stored in the closed-count summary JSON. */
function toSummaryAsset(a) {
  return {
    assetTag: a.asset_tag,
    brand: a.brand,
    model: a.model,
    category: a.category,
    status: a.status,
    location: a.location,
    holder: a.current_employee_name || null,
    serialNumber: a.serial_number || null,
  };
}

/** Older closed counts only stored a found *count* — rebuild the device list. */
function ensureFoundDevices(summary, expected, scans) {
  const s = summary && typeof summary === 'object' ? { ...summary } : {};
  if (Array.isArray(s.foundDevices)) return s;
  const scannedIds = new Set(scans.filter((x) => x.assetId).map((x) => x.assetId));
  s.foundDevices = expected.filter((a) => scannedIds.has(a.id)).map(toSummaryAsset);
  return s;
}

async function getCount(id) {
  if (!isUuid(id)) throw HttpError.notFound('Count not found');
  const { rows } = await query('SELECT * FROM stock_counts WHERE id = $1', [id]);
  if (!rows[0]) throw HttpError.notFound('Count not found');
  const count = mapRow(rows[0]);
  const scans = await query(
    'SELECT * FROM stock_count_scans WHERE count_id = $1 ORDER BY scanned_at DESC', [id]
  );
  const expected = await expectedAssets(count.location);
  count.scans = mapRows(scans.rows);
  count.expectedTotal = expected.length;
  count.matchedTotal = count.scans.filter((s) => s.matched).length;
  if (count.status === 'closed' && count.summary) {
    count.summary = ensureFoundDevices(count.summary, expected, count.scans);
  }
  return count;
}

/** Escape LIKE wildcards so a serial containing "_" or "%" stays literal. */
function likeEscape(q) {
  return String(q).replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * Partial-match lookup for the scan box: typing part of a tag or serial lists
 * the devices it could be, so the operator can pick one instead of guessing the
 * rest of the code. Scoped to the same set the count expects (non-scrap, and
 * the session's location when it has one) and flags what is already counted.
 */
async function suggestAssets(countId, q, { limit = 8 } = {}) {
  if (!isUuid(countId)) throw HttpError.notFound('Count not found');
  const term = String(q || '').trim();
  if (term.length < 2) return [];

  const { rows: countRows } = await query('SELECT location FROM stock_counts WHERE id = $1', [countId]);
  if (!countRows[0]) throw HttpError.notFound('Count not found');

  const escaped = likeEscape(term.slice(0, 120));
  const params = [countId, `%${escaped}%`, `${escaped}%`];
  let locationSql = '';
  if (countRows[0].location) {
    params.push(countRows[0].location);
    locationSql = ` AND a.location = $${params.length}`;
  }
  params.push(Math.min(Math.max(Number(limit) || 8, 1), 25));

  const { rows } = await query(
    `SELECT a.id, a.asset_tag, a.serial_number, a.brand, a.model, a.category,
            a.status, a.location, a.current_employee_name,
            EXISTS (SELECT 1 FROM stock_count_scans s
                     WHERE s.count_id = $1 AND s.asset_id = a.id) AS scanned
       FROM assets a
      WHERE a.status <> 'Scrap'${locationSql}
        AND (a.asset_tag ILIKE $2 ESCAPE '\\'
             OR COALESCE(a.serial_number, '') ILIKE $2 ESCAPE '\\'
             OR COALESCE(a.brand, '') ILIKE $2 ESCAPE '\\'
             OR COALESCE(a.model, '') ILIKE $2 ESCAPE '\\')
      -- Codes the operator is actually typing rank first: starts-with, then any
      -- tag/serial hit, and only then a brand/model coincidence.
      ORDER BY (a.asset_tag ILIKE $3 ESCAPE '\\'
                OR COALESCE(a.serial_number, '') ILIKE $3 ESCAPE '\\') DESC,
               (a.asset_tag ILIKE $2 ESCAPE '\\'
                OR COALESCE(a.serial_number, '') ILIKE $2 ESCAPE '\\') DESC,
               LENGTH(a.asset_tag), a.asset_tag
      LIMIT $${params.length}`,
    params
  );
  return mapRows(rows);
}

/** Record one scan. Duplicates (same raw in the same count) are idempotent. */
async function scanTag(countId, raw, itUser) {
  if (!isUuid(countId)) throw HttpError.notFound('Count not found');
  const tag = normalizeTag(raw);
  if (!tag || tag.length > 120) throw HttpError.badRequest('Empty or invalid scan');

  return withTransaction(async (t) => {
    const c = await t.query('SELECT * FROM stock_counts WHERE id = $1 FOR UPDATE', [countId]);
    if (!c.rows[0]) throw HttpError.notFound('Count not found');
    if (c.rows[0].status !== 'open') throw HttpError.conflict('This count is closed');

    // Match by asset tag OR serial number (trimmed, case-insensitive), so typing
    // either during a manual count — or scanning a serial barcode — finds the device.
    const a = await t.query(
      `SELECT id, asset_tag, brand, model, category, status, current_employee_name
       FROM assets
       WHERE UPPER(TRIM(asset_tag)) = $1
          OR UPPER(TRIM(serial_number)) = $1`,
      [tag]
    );
    const asset = a.rows[0] || null;
    const ins = await t.query(
      `INSERT INTO stock_count_scans (count_id, raw, asset_id, asset_tag, matched, scanned_by_name)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (count_id, raw) DO UPDATE SET scanned_at = stock_count_scans.scanned_at
       RETURNING *, (xmax <> 0) AS duplicate`,
      [countId, tag, asset ? asset.id : null, asset ? asset.asset_tag : null, !!asset,
       itUser.username || itUser.email]
    );
    const row = mapRow(ins.rows[0]);
    row.asset = asset ? mapRow(asset) : null;
    return row;
  });
}

/** Close the count and persist the comparison summary. */
async function closeCount(id, itUser) {
  if (!isUuid(id)) throw HttpError.notFound('Count not found');
  const { rows } = await query('SELECT * FROM stock_counts WHERE id = $1', [id]);
  if (!rows[0]) throw HttpError.notFound('Count not found');
  if (rows[0].status !== 'open') throw HttpError.conflict('This count is already closed');

  const count = mapRow(rows[0]);
  const [expected, scansRes] = await Promise.all([
    expectedAssets(count.location),
    query('SELECT * FROM stock_count_scans WHERE count_id = $1', [id]),
  ]);
  const scans = mapRows(scansRes.rows);
  const scannedIds = new Set(scans.filter((s) => s.assetId).map((s) => s.assetId));

  const foundDevices = expected.filter((a) => scannedIds.has(a.id)).map(toSummaryAsset);
  const missing = expected.filter((a) => !scannedIds.has(a.id)).map(toSummaryAsset);
  const unexpected = scans.filter((s) => !s.matched).map((s) => s.raw);

  const summary = {
    expected: expected.length,
    found: foundDevices.length,
    foundDevices,
    missing,
    missingCount: missing.length,
    unexpected,
    unexpectedCount: unexpected.length,
    closedBy: itUser.username || itUser.email,
  };
  const upd = await query(
    `UPDATE stock_counts SET status = 'closed', closed_at = now(), summary = $2::jsonb
     WHERE id = $1 RETURNING *`,
    [id, JSON.stringify(summary)]
  );
  return mapRow(upd.rows[0]);
}

module.exports = { createCount, listCounts, getCount, suggestAssets, scanTag, closeCount };
