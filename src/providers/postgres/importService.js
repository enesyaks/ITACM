/**
 * Excel/CSV inventory migration.
 *
 * One row = one asset, optionally with the employee it is assigned to. The
 * importer auto-creates everything referenced: employees (deduped by email),
 * catalog brand/model entries, the assets themselves (auto asset tags when the
 * tag column is blank) and one handover (zimmet) per employee covering all of
 * their rows — with full asset history, exactly as if done through the UI.
 *
 * dryRun=true validates and returns the plan without touching the database;
 * the commit runs in a single transaction over the valid rows only.
 */
const { query, withTransaction } = require('./pool');
const { HttpError } = require('../../utils/httpError');

const CATEGORIES = ['Laptop', 'Desktop', 'Monitor', 'Television', 'Phone', 'Tablet', 'Printer', 'Network',
  'Keyboard', 'Mouse', 'Headset', 'Docking Station', 'Webcam', 'Peripheral', 'Accessory', 'Other'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_ROWS = 5000;

const s = (v) => (v == null ? '' : String(v).trim());

/** Normalise one raw row; returns { ok, data } or { ok:false, error }. */
function parseRow(r) {
  const data = {
    employeeName: s(r.employeeName), employeeEmail: s(r.employeeEmail).toLowerCase(),
    department: s(r.department), title: s(r.title),
    assetTag: s(r.assetTag).toUpperCase(), category: s(r.category), brand: s(r.brand),
    model: s(r.model), serialNumber: s(r.serialNumber), mac: s(r.mac),
    cpu: s(r.cpu), ram: s(r.ram), storage: s(r.storage), os: s(r.os),
    location: s(r.location), purchaseDate: s(r.purchaseDate),
  };
  if (!data.serialNumber) return { ok: false, error: 'serialNumber is required' };
  if (!data.brand || !data.model) return { ok: false, error: 'brand and model are required' };
  if (!data.category) data.category = 'Other';
  const canonical = CATEGORIES.find((c) => c.toLowerCase() === data.category.toLowerCase());
  if (!canonical) return { ok: false, error: `unknown category "${data.category}" — use one of: ${CATEGORIES.join(', ')}` };
  data.category = canonical;
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

  const errors = [];
  const valid = [];
  const seenSerials = new Set();
  const seenTags = new Set();
  rows.forEach((raw, i) => {
    const rowNo = i + 2; // +1 for header, +1 for 1-based
    const p = parseRow(raw || {});
    if (!p.ok) return errors.push({ row: rowNo, error: p.error });
    if (seenSerials.has(p.data.serialNumber)) return errors.push({ row: rowNo, error: `duplicate serialNumber "${p.data.serialNumber}" in the file` });
    seenSerials.add(p.data.serialNumber);
    if (p.data.assetTag) {
      if (seenTags.has(p.data.assetTag)) return errors.push({ row: rowNo, error: `duplicate assetTag "${p.data.assetTag}" in the file` });
      seenTags.add(p.data.assetTag);
    }
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

  const emails = [...new Set(valid.filter((v) => v.employeeEmail).map((v) => v.employeeEmail))];
  const existing = emails.length
    ? (await query('SELECT id, email FROM employees WHERE email = ANY($1)', [emails])).rows
    : [];
  const existingEmails = new Set(existing.map((e) => e.email));

  const catalogKeys = [...new Set(valid.map((v) => `${v.category}|${v.brand}|${v.model}`))];

  return {
    valid, errors,
    plan: {
      totalRows: rows.length,
      assets: valid.length,
      employeesNew: emails.filter((e) => !existingEmails.has(e)).length,
      employeesExisting: existingEmails.size,
      handovers: emails.length,
      catalogEntries: catalogKeys.length,
      errorCount: errors.length,
    },
    existingByEmail: Object.fromEntries(existing.map((e) => [e.email, e.id])),
  };
}

async function importInventory(rows, { dryRun = false } = {}, itUser) {
  const { valid, errors, plan, existingByEmail } = await analyse(rows);
  if (dryRun) return { dryRun: true, ...plan, errors };
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

    // 3) assets — sequential tags allocated once for the whole batch
    const mx = await t.query(
      `SELECT COALESCE(MAX(substring(asset_tag FROM '^IT-([0-9]+)$')::int), 1000) AS mx
       FROM assets WHERE asset_tag ~ '^IT-[0-9]+$'`
    );
    let nextNo = mx.rows[0].mx;
    for (const v of valid) {
      const tag = v.assetTag || `IT-${String(++nextNo).padStart(4, '0')}`;
      const specs = { cpu: v.cpu || null, ram: v.ram || null, storage: v.storage || null, os: v.os || null };
      const ins = await t.query(
        `INSERT INTO assets (asset_tag, serial_number, brand, model, category, mac_ethernet,
                             specs, status, purchase_date, qr_code_string, location)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,'In Stock',$8,$9,$10) RETURNING id`,
        [tag, v.serialNumber, v.brand, v.model, v.category, v.mac || null,
         JSON.stringify(specs), v.purchaseDate, `ITACPRO|ASSET|${tag}`, v.location || null]
      );
      v._assetId = ins.rows[0].id;
      v._tag = tag;
    }

    // 4) one handover per employee covering all their rows (+ history + counts)
    const byEmp = new Map();
    valid.filter((v) => v.employeeEmail).forEach((v) => {
      (byEmp.get(v.employeeEmail) || byEmp.set(v.employeeEmail, []).get(v.employeeEmail)).push(v);
    });
    let handovers = 0;
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
        await t.query(
          `UPDATE assets SET status='Assigned', current_employee_id=$2, current_employee_name=$3 WHERE id=$1`,
          [v._assetId, eid, name]
        );
        await t.query(
          `INSERT INTO asset_history (asset_id, asset_tag, employee_id, employee_name, action_type, notes, changed_by, changed_by_name)
           VALUES ($1,$2,$3,$4,'assigned','Migrated from Excel import',$5,$6)`,
          [v._assetId, v._tag, eid, name, by[0], by[1]]
        );
      }
      await t.query('UPDATE employees SET active_asset_count = active_asset_count + $2 WHERE id = $1', [eid, items.length]);
      handovers++;
    }

    return { imported: valid.length, handovers, employees: Object.keys(empId).length };
  });

  return { dryRun: false, ...plan, ...result, errors };
}

module.exports = { importInventory };
