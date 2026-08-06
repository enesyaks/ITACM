/**
 * Excel/CSV inventory migration.
 *
 * One row = one asset, optionally with the employee it is assigned to. The
 * importer auto-creates employees (deduped by email), catalog brand/model
 * entries, assets (auto asset tags when blank) and one handover (zimmet) per
 * employee. Locations must already exist in Product Catalog (case-insensitive
 * match → canonical name); unknown locations are rejected.
 *
 * dryRun=true validates and returns the plan without touching the database;
 * the commit runs in a single transaction over the valid rows only.
 */
const { query, withTransaction } = require('./pool');
const { HttpError } = require('../../utils/httpError');
const { getSettings } = require('./settingsService');
const { DEFAULT_LOCATIONS } = require('../../utils/defaults');

const CATEGORIES = ['Laptop', 'Desktop', 'Monitor', 'Television', 'Phone', 'Tablet', 'Printer', 'Network',
  'Keyboard', 'Mouse', 'Headset', 'Docking Station', 'Webcam', 'Peripheral', 'Accessory', 'Other'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_ROWS = 5000;

const s = (v) => (v == null ? '' : String(v).trim());

async function loadKnownLocations() {
  try {
    const settings = await getSettings();
    const list = (settings.locations && settings.locations.length)
      ? settings.locations
      : [...DEFAULT_LOCATIONS];
    return list.map((l) => String(l).trim()).filter(Boolean);
  } catch {
    return [...DEFAULT_LOCATIONS];
  }
}

function resolveLocation(raw, knownLocations) {
  const loc = s(raw);
  if (!loc) return { ok: true, location: null };
  const match = knownLocations.find((l) => l.toLowerCase() === loc.toLowerCase());
  if (!match) {
    const hint = knownLocations.slice(0, 8).join(', ')
      + (knownLocations.length > 8 ? ', …' : '');
    return {
      ok: false,
      error: `unknown location "${loc}" — add it in Product Catalog → Locations, or use one of: ${hint}`,
    };
  }
  return { ok: true, location: match };
}

/** Normalise one raw row; returns { ok, data } or { ok:false, error }. */
function parseRow(r, knownLocations = []) {
  const data = {
    employeeName: s(r.employeeName), employeeEmail: s(r.employeeEmail).toLowerCase(),
    department: s(r.department), title: s(r.title),
    assetTag: s(r.assetTag).toUpperCase(), category: s(r.category), brand: s(r.brand),
    model: s(r.model), serialNumber: s(r.serialNumber), imei: s(r.imei), imei2: s(r.imei2), mac: s(r.mac),
    cpu: s(r.cpu), ram: s(r.ram), storage: s(r.storage), os: s(r.os),
    location: s(r.location), purchaseDate: s(r.purchaseDate),
  };
  if (!data.serialNumber) return { ok: false, error: 'serialNumber is required' };
  if (!data.brand || !data.model) return { ok: false, error: 'brand and model are required' };
  if (!data.category) data.category = 'Other';
  const canonical = CATEGORIES.find((c) => c.toLowerCase() === data.category.toLowerCase());
  if (!canonical) return { ok: false, error: `unknown category "${data.category}" — use one of: ${CATEGORIES.join(', ')}` };
  data.category = canonical;
  // Always returns a result object — a bare `null` here would make the
  // `.error` reads below throw on every row that has no IMEI (most of them).
  const parseImei = (raw, label) => {
    if (!raw) return { value: null };
    const digits = raw.replace(/[\s\-]/g, '');
    if (!/^\d{14,16}$/.test(digits)) {
      return { error: `invalid ${label} "${raw}" — use 14–16 digits` };
    }
    return { value: digits };
  };
  const i1 = parseImei(data.imei, 'IMEI');
  if (i1.error) return { ok: false, error: i1.error };
  data.imei = i1.value;
  const i2 = parseImei(data.imei2, 'IMEI 2');
  if (i2.error) return { ok: false, error: i2.error };
  data.imei2 = i2.value;
  if (data.imei && data.imei2 && data.imei === data.imei2) {
    return { ok: false, error: 'IMEI and IMEI 2 must be different' };
  }
  const loc = resolveLocation(data.location, knownLocations);
  if (!loc.ok) return loc;
  data.location = loc.location || '';
  if (data.employeeName && !data.employeeEmail) return { ok: false, error: 'employeeEmail is required when employeeName is set (it is the dedupe key)' };
  if (data.employeeEmail && !EMAIL_RE.test(data.employeeEmail)) return { ok: false, error: `invalid email "${data.employeeEmail}"` };
  if (data.purchaseDate) {
    const d = new Date(data.purchaseDate);
    if (Number.isNaN(d.getTime())) return { ok: false, error: `unparseable purchaseDate "${data.purchaseDate}" — use YYYY-MM-DD` };
    data.purchaseDate = d;
  } else data.purchaseDate = null;
  return { ok: true, data };
}

async function analyse(rows) {
  if (!Array.isArray(rows) || !rows.length) throw HttpError.badRequest('rows must be a non-empty array');
  if (rows.length > MAX_ROWS) throw HttpError.badRequest(`Too many rows — max ${MAX_ROWS} per import`);

  const knownLocations = await loadKnownLocations();
  const errors = [];
  const valid = [];
  const seenSerials = new Set();
  const seenTags = new Set();
  const seenImeis = new Set();
  rows.forEach((raw, i) => {
    const rowNo = i + 2; // +1 for header, +1 for 1-based
    const p = parseRow(raw || {}, knownLocations);
    if (!p.ok) return errors.push({ row: rowNo, error: p.error });
    const snKey = String(p.data.serialNumber || '').trim().toLowerCase();
    if (seenSerials.has(snKey)) return errors.push({ row: rowNo, error: `duplicate serialNumber "${p.data.serialNumber}" in the file` });
    if (p.data.assetTag && seenTags.has(p.data.assetTag)) {
      return errors.push({ row: rowNo, error: `duplicate assetTag "${p.data.assetTag}" in the file` });
    }
    // IMEI is uniquely indexed across both columns, so a repeat inside the file
    // would abort the whole commit transaction with a raw constraint error.
    const rowImeis = [p.data.imei, p.data.imei2].filter(Boolean);
    const dupImei = rowImeis.find((v) => seenImeis.has(v));
    if (dupImei) return errors.push({ row: rowNo, error: `duplicate IMEI "${dupImei}" in the file` });

    seenSerials.add(snKey);
    if (p.data.assetTag) seenTags.add(p.data.assetTag);
    rowImeis.forEach((v) => seenImeis.add(v));
    valid.push({ rowNo, ...p.data });
  });

  // Collisions with data already in the system.
  if (seenTags.size) {
    const { rows: hit } = await query(
      'SELECT asset_tag FROM assets WHERE asset_tag = ANY($1)', [[...seenTags]]
    );
    const taken = new Set(hit.map((h) => h.asset_tag));
    for (let i = valid.length - 1; i >= 0; i--) {
      if (valid[i].assetTag && taken.has(valid[i].assetTag)) {
        errors.push({ row: valid[i].rowNo, error: `assetTag "${valid[i].assetTag}" already exists in the system` });
        valid.splice(i, 1);
      }
    }
  }
  if (seenSerials.size) {
    const remainingSerials = valid.map((v) => String(v.serialNumber || '').trim().toLowerCase()).filter(Boolean);
    if (remainingSerials.length) {
      const { rows: hitSn } = await query(
        'SELECT serial_number FROM assets WHERE lower(btrim(serial_number)) = ANY($1::text[])',
        [remainingSerials]
      );
      const takenSn = new Set(hitSn.map((h) => String(h.serial_number || '').trim().toLowerCase()));
      for (let i = valid.length - 1; i >= 0; i--) {
        const vKey = String(valid[i].serialNumber || '').trim().toLowerCase();
        if (takenSn.has(vKey)) {
          errors.push({
            row: valid[i].rowNo,
            error: `serialNumber "${valid[i].serialNumber}" already exists in the system`,
          });
          valid.splice(i, 1);
        }
      }
    }
  }

  // Collisions with IMEIs already stored — matched against both columns, the
  // same way migrations 047/048 index them.
  const remainingImeis = [...new Set(valid.flatMap((v) => [v.imei, v.imei2].filter(Boolean)))];
  if (remainingImeis.length) {
    const { rows: hitImei } = await query(
      `SELECT lower(btrim(imei)) AS v FROM assets
        WHERE imei IS NOT NULL AND lower(btrim(imei)) = ANY($1::text[])
       UNION
       SELECT lower(btrim(imei2)) AS v FROM assets
        WHERE imei2 IS NOT NULL AND lower(btrim(imei2)) = ANY($1::text[])`,
      [remainingImeis]
    );
    const takenImei = new Set(hitImei.map((h) => h.v));
    for (let i = valid.length - 1; i >= 0; i--) {
      const hit = [valid[i].imei, valid[i].imei2].filter(Boolean).find((v) => takenImei.has(v));
      if (hit) {
        errors.push({ row: valid[i].rowNo, error: `IMEI "${hit}" already exists in the system` });
        valid.splice(i, 1);
      }
    }
  }

  const emails = [...new Set(valid.filter((v) => v.employeeEmail).map((v) => v.employeeEmail))];
  const existing = emails.length
    ? (await query('SELECT id, email FROM employees WHERE email = ANY($1)', [emails])).rows
    : [];
  const existingEmails = new Set(existing.map((e) => e.email));

  const catalogKeys = [...new Set(valid.map((v) => `${v.category}|${v.brand}|${v.model}`))];
  const assigned = valid.filter((v) => v.employeeEmail).length;
  const inStock = valid.length - assigned;
  const autoTagged = valid.filter((v) => !v.assetTag).length;
  const categoryCounts = {};
  for (const v of valid) {
    categoryCounts[v.category] = (categoryCounts[v.category] || 0) + 1;
  }

  const preview = valid.slice(0, 60).map((v) => ({
    row: v.rowNo,
    assetTag: v.assetTag || null,
    brand: v.brand,
    model: v.model,
    serialNumber: v.serialNumber,
    category: v.category,
    location: v.location || null,
    employeeName: v.employeeName || null,
    employeeEmail: v.employeeEmail || null,
    employeeExisting: v.employeeEmail ? existingEmails.has(v.employeeEmail) : false,
    destination: v.employeeEmail ? 'Assigned' : 'In Stock',
  }));

  return {
    valid, errors,
    plan: {
      totalRows: rows.length,
      assets: valid.length,
      assigned,
      inStock,
      autoTagged,
      employeesNew: emails.filter((e) => !existingEmails.has(e)).length,
      employeesExisting: existingEmails.size,
      handovers: emails.length,
      catalogEntries: catalogKeys.length,
      errorCount: errors.length,
      categoryCounts,
      knownLocations,
    },
    preview,
    existingByEmail: Object.fromEntries(existing.map((e) => [e.email, e.id])),
  };
}

async function importInventory(rows, { dryRun = false } = {}, itUser) {
  const { valid, errors, plan, preview, existingByEmail } = await analyse(rows);
  if (dryRun) return { dryRun: true, ...plan, errors, preview };
  if (!valid.length) throw HttpError.badRequest('No valid rows to import — fix the errors and retry');

  const by = [itUser.uid, itUser.username || itUser.email];

  const result = await withTransaction(async (t) => {
    // 1) employees (dedupe by email)
    const empId = { ...existingByEmail };
    for (const v of valid) {
      if (!v.employeeEmail || empId[v.employeeEmail]) continue;
      const ins = await t.query(
        `INSERT INTO employees (full_name, email, department, title)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
         RETURNING id`,
        [v.employeeName || v.employeeEmail, v.employeeEmail, v.department || null, v.title || null]
      );
      empId[v.employeeEmail] = ins.rows[0].id;
    }

    // 2) catalog entries
    for (const key of new Set(valid.map((v) => `${v.category}|${v.brand}|${v.model}`))) {
      const [category, brand, model] = key.split('|');
      await t.query(
        `INSERT INTO catalog_models (category, brand, model) VALUES ($1,$2,$3)
         ON CONFLICT (category, brand, model) DO NOTHING`,
        [category, brand, model]
      );
    }

    // 3) assets — sequential tags allocated once for the whole batch (uses company prefix)
    const settings = await getSettings();
    const tagPrefix = settings.assetTagPrefix || 'IT';
    const mx = await t.query(
      `SELECT COALESCE(MAX(substring(asset_tag FROM $1)::int), 1000) AS mx
       FROM assets WHERE asset_tag ~ $2`,
      [`^${tagPrefix}-([0-9]+)$`, `^${tagPrefix}-[0-9]+$`]
    );
    let nextNo = mx.rows[0].mx;
    for (const v of valid) {
      v._tag = v.assetTag || `${tagPrefix}-${String(++nextNo).padStart(4, '0')}`;
    }
    // One round trip for the whole batch. A per-row INSERT meant up to MAX_ROWS
    // (5000) round trips with the import transaction held open the whole time.
    const insAssets = await t.query(
      `INSERT INTO assets (asset_tag, serial_number, brand, model, category, mac_ethernet,
                           imei, imei2, specs, status, purchase_date, qr_code_string, location)
       SELECT u.tag, u.serial, u.brand, u.model, u.category, u.mac,
              u.imei, u.imei2, u.specs::jsonb, 'In Stock', u.purchase_date,
              'ITACPRO|ASSET|' || u.tag, u.location
         FROM UNNEST($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[],
                     $7::text[], $8::text[], $9::text[], $10::timestamptz[], $11::text[])
           AS u(tag, serial, brand, model, category, mac, imei, imei2, specs, purchase_date, location)
       RETURNING id, asset_tag`,
      [
        valid.map((v) => v._tag),
        valid.map((v) => v.serialNumber),
        valid.map((v) => v.brand),
        valid.map((v) => v.model),
        valid.map((v) => v.category),
        valid.map((v) => v.mac || null),
        valid.map((v) => v.imei || null),
        valid.map((v) => v.imei2 || null),
        valid.map((v) => JSON.stringify({
          cpu: v.cpu || null, ram: v.ram || null, storage: v.storage || null, os: v.os || null,
        })),
        valid.map((v) => v.purchaseDate),
        valid.map((v) => v.location || null),
      ]
    );
    // Asset tags are unique across the batch (analyse rejects repeats), so they
    // key generated ids back onto their rows without trusting RETURNING order.
    const idByTag = new Map(insAssets.rows.map((r) => [r.asset_tag, r.id]));
    for (const v of valid) v._assetId = idByTag.get(v._tag);

    // 4) one handover per employee covering all their rows (+ history + counts)
    const byEmp = new Map();
    valid.filter((v) => v.employeeEmail).forEach((v) => {
      (byEmp.get(v.employeeEmail) || byEmp.set(v.employeeEmail, []).get(v.employeeEmail)).push(v);
    });
    let handovers = 0;
    // Collected across every employee so the asset flips and the history rows
    // each cost one round trip for the whole import, not one per asset.
    const assign = { assetIds: [], tags: [], empIds: [], empNames: [] };
    for (const [email, items] of byEmp) {
      const eid = empId[email];
      const name = items[0].employeeName || email;
      const receiptItems = items.map((v) => ({
        assetId: v._assetId, assetTag: v._tag, brand: v.brand, model: v.model,
        category: v.category, serialNumber: v.serialNumber, macAddress: v.mac || null,
        conditionNote: 'Migrated from Excel',
      }));
      await t.query(
        `INSERT INTO handovers (employee_id, employee_name, it_user_id, it_user_name, document_type, items)
         VALUES ($1,$2,$3,$4,'single',$5::jsonb)`,
        [eid, name, by[0], by[1], JSON.stringify(receiptItems)]
      );
      for (const v of items) {
        assign.assetIds.push(v._assetId);
        assign.tags.push(v._tag);
        assign.empIds.push(eid);
        assign.empNames.push(name);
      }
      await t.query('UPDATE employees SET active_asset_count = active_asset_count + $2 WHERE id = $1', [eid, items.length]);
      handovers++;
    }

    if (assign.assetIds.length) {
      await t.query(
        `UPDATE assets a
            SET status = 'Assigned', current_employee_id = u.emp_id,
                current_employee_name = u.emp_name, updated_at = now()
           FROM UNNEST($1::uuid[], $2::uuid[], $3::text[]) AS u(asset_id, emp_id, emp_name)
          WHERE a.id = u.asset_id`,
        [assign.assetIds, assign.empIds, assign.empNames]
      );
      await t.query(
        `INSERT INTO asset_history
           (asset_id, asset_tag, employee_id, employee_name, action_type, notes, changed_by, changed_by_name)
         SELECT u.asset_id, u.tag, u.emp_id, u.emp_name,
                'assigned', 'Migrated from Excel import', $5, $6
           FROM UNNEST($1::uuid[], $2::text[], $3::uuid[], $4::text[])
             AS u(asset_id, tag, emp_id, emp_name)`,
        [assign.assetIds, assign.tags, assign.empIds, assign.empNames, by[0], by[1]]
      );
    }

    return { imported: valid.length, handovers, employees: Object.keys(empId).length };
  });

  return { dryRun: false, ...plan, ...result, errors };
}

module.exports = { importInventory };
