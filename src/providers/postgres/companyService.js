/**
 * Companies (postgres) — the legal entities an install operates.
 *
 * One row per entity, `parentId` putting a subsidiary under its group. Every
 * branding field is optional: a NULL logo/address/terms falls back to the
 * group-level `app_settings` values, which is why a single-company install
 * never has to open this screen at all.
 *
 * `resolveBranding()` is the single place that does that fallback — the zimmet
 * PDF, the report PDF and the handover snapshot all go through it, so they can
 * never disagree about whose letterhead a document carries.
 */
const { query, withTransaction } = require('./pool');
const { mapRow, mapRows, isUuid } = require('./rowMapper');
const { HttpError } = require('../../utils/httpError');

const MAX_DEPTH = 6; // holding → subsidiary → … ; deep enough, and cycle-proof.

const COLS = `id, parent_id, name, legal_name, code, logo, address, tax_office, tax_no,
              email, phone, handover_terms, handover_template_id,
              is_default, active, notes, created_at, updated_at`;

const trimOrNull = (v, max) => {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};

/** Same data-URL rule the settings logo uses — keeps the PDF encoder happy. */
function validateLogo(logo) {
  if (logo == null || logo === '') return null;
  const s = String(logo);
  if (!/^data:image\/[a-z0-9.+-]+;base64,/i.test(s)) {
    throw HttpError.badRequest('logo must be a data:image/... base64 URL');
  }
  if (s.length > 400_000) throw HttpError.badRequest('logo is too large (max ~300KB)');
  return s;
}

function sanitize(input, { partial = false } = {}) {
  const b = input || {};
  const out = {};
  const has = (k) => !partial || k in b;

  if (has('name')) {
    const name = trimOrNull(b.name, 120);
    if (!name) throw HttpError.badRequest('Company name is required');
    out.name = name;
  }
  if (has('legalName')) out.legal_name = trimOrNull(b.legalName, 200);
  if (has('code')) {
    const code = trimOrNull(b.code, 16);
    if (code && !/^[A-Za-z0-9_-]+$/.test(code)) {
      throw HttpError.badRequest('code may only contain letters, digits, - and _');
    }
    out.code = code ? code.toUpperCase() : null;
  }
  if (has('logo')) out.logo = validateLogo(b.logo);
  if (has('address')) out.address = trimOrNull(b.address, 300);
  if (has('taxOffice')) out.tax_office = trimOrNull(b.taxOffice, 120);
  if (has('taxNo')) out.tax_no = trimOrNull(b.taxNo, 40);
  if (has('email')) out.email = trimOrNull(b.email, 200);
  if (has('phone')) out.phone = trimOrNull(b.phone, 40);
  if (has('handoverTerms')) out.handover_terms = trimOrNull(b.handoverTerms, 8000);
  if (has('handoverTemplateId')) out.handover_template_id = trimOrNull(b.handoverTemplateId, 64);
  if (has('notes')) out.notes = trimOrNull(b.notes, 2000) || '';
  if (has('active')) out.active = b.active !== false;
  if (has('parentId')) {
    if (b.parentId == null || b.parentId === '') out.parent_id = null;
    else if (!isUuid(b.parentId)) throw HttpError.badRequest('parentId must be a company id');
    else out.parent_id = b.parentId;
  }
  return out;
}

/**
 * Walk up from `parentId` and refuse if `id` shows up — a company that is its
 * own ancestor makes the tree render forever and the branding lookup loop.
 *
 * `id` is null when creating: there is no row yet, so nothing can point back at
 * it and only the depth limit applies. The null must be excluded explicitly —
 * the walk ends with `cursor` at null (a top-level parent), and comparing that
 * to a null `id` matched, so every subsidiary of a top-level company was
 * rejected as a loop.
 */
async function assertNoCycle(client, id, parentId) {
  if (!parentId) return;
  if (id && parentId === id) throw HttpError.badRequest('A company cannot be its own parent');
  let cursor = parentId;
  for (let depth = 0; cursor && depth < MAX_DEPTH; depth += 1) {
    const { rows } = await client.query('SELECT parent_id FROM companies WHERE id = $1', [cursor]);
    if (!rows[0]) throw HttpError.badRequest('Parent company not found');
    cursor = rows[0].parent_id;
    if (id && cursor === id) throw HttpError.badRequest('That parent would create a loop in the company tree');
  }
  if (cursor) throw HttpError.badRequest(`Company nesting is limited to ${MAX_DEPTH} levels`);
}

/* ---------------------------------- Reads ---------------------------------- */

async function listCompanies({ includeInactive = true } = {}) {
  const where = includeInactive ? '' : 'WHERE active';
  const { rows } = await query(
    `SELECT ${COLS} FROM companies ${where} ORDER BY is_default DESC, lower(name)`
  );
  return mapRows(rows);
}

/** Slim list for pickers and the client bootstrap — no logo payloads. */
async function listCompanyOptions() {
  const { rows } = await query(
    `SELECT id, name, code, parent_id, is_default, active
       FROM companies ORDER BY is_default DESC, lower(name)`
  );
  return mapRows(rows);
}

async function getCompany(id) {
  if (!isUuid(id)) throw HttpError.badRequest('Invalid company id');
  const { rows } = await query(`SELECT ${COLS} FROM companies WHERE id = $1`, [id]);
  if (!rows[0]) throw HttpError.notFound(`Company ${id} not found`);
  return mapRow(rows[0]);
}

async function getDefaultCompany() {
  const { rows } = await query(`SELECT ${COLS} FROM companies WHERE is_default LIMIT 1`);
  if (rows[0]) return mapRow(rows[0]);
  const any = await query(`SELECT ${COLS} FROM companies ORDER BY created_at LIMIT 1`);
  return any.rows[0] ? mapRow(any.rows[0]) : null;
}

/** Companies with how many records each one owns — feeds the Firmalar table. */
async function listCompaniesWithCounts() {
  const { rows } = await query(`
    SELECT c.id, c.parent_id, c.name, c.legal_name, c.code, c.logo, c.address,
           c.tax_office, c.tax_no, c.email, c.phone, c.handover_terms,
           c.handover_template_id, c.is_default, c.active, c.notes,
           c.created_at, c.updated_at,
           (SELECT count(*) FROM assets       a WHERE a.company_id = c.id) AS asset_count,
           (SELECT count(*) FROM employees    e WHERE e.company_id = c.id) AS employee_count,
           (SELECT count(*) FROM mobile_lines l WHERE l.company_id = c.id) AS line_count,
           (SELECT count(*) FROM licenses     s WHERE s.company_id = c.id) AS license_count,
           (SELECT count(*) FROM contracts    k WHERE k.company_id = c.id) AS contract_count
      FROM companies c
     ORDER BY c.is_default DESC, lower(c.name)`);
  return mapRows(rows).map((r) => ({
    ...r,
    assetCount: Number(r.assetCount || 0),
    employeeCount: Number(r.employeeCount || 0),
    lineCount: Number(r.lineCount || 0),
    licenseCount: Number(r.licenseCount || 0),
    contractCount: Number(r.contractCount || 0),
  }));
}

/* --------------------------------- Writes ---------------------------------- */

async function createCompany(input) {
  const data = sanitize(input);
  return withTransaction(async (t) => {
    await assertNoCycle(t, null, data.parent_id || null);
    const isFirst = (await t.query('SELECT 1 FROM companies LIMIT 1')).rows.length === 0;
    try {
      const { rows } = await t.query(
        `INSERT INTO companies (parent_id, name, legal_name, code, logo, address, tax_office,
                                tax_no, email, phone, handover_terms, handover_template_id,
                                active, notes, is_default)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,COALESCE($13, TRUE),COALESCE($14,''),$15)
         RETURNING ${COLS}`,
        [
          data.parent_id ?? null, data.name, data.legal_name ?? null, data.code ?? null,
          data.logo ?? null, data.address ?? null, data.tax_office ?? null, data.tax_no ?? null,
          data.email ?? null, data.phone ?? null, data.handover_terms ?? null,
          data.handover_template_id ?? null, data.active ?? null, data.notes ?? null, isFirst,
        ]
      );
      return mapRow(rows[0]);
    } catch (err) {
      if (err.code === '23505') throw HttpError.conflict(`A company named "${data.name}" already exists`);
      throw err;
    }
  });
}

async function updateCompany(id, input) {
  if (!isUuid(id)) throw HttpError.badRequest('Invalid company id');
  const data = sanitize(input, { partial: true });
  if (!Object.keys(data).length) return getCompany(id);

  return withTransaction(async (t) => {
    const cur = await t.query('SELECT id, is_default FROM companies WHERE id = $1 FOR UPDATE', [id]);
    if (!cur.rows[0]) throw HttpError.notFound(`Company ${id} not found`);
    if ('parent_id' in data) await assertNoCycle(t, id, data.parent_id);
    if (data.active === false && cur.rows[0].is_default) {
      throw HttpError.badRequest('The default company cannot be deactivated');
    }

    const sets = [];
    const params = [];
    for (const [col, value] of Object.entries(data)) {
      params.push(value);
      sets.push(`${col} = $${params.length}`);
    }
    params.push(id);
    try {
      const { rows } = await t.query(
        `UPDATE companies SET ${sets.join(', ')}, updated_at = now()
          WHERE id = $${params.length} RETURNING ${COLS}`,
        params
      );
      return mapRow(rows[0]);
    } catch (err) {
      if (err.code === '23505') throw HttpError.conflict('Another company already uses that name or code');
      throw err;
    }
  });
}

/** Exactly one default; used as the fallback on every form that needs a company. */
async function setDefaultCompany(id) {
  if (!isUuid(id)) throw HttpError.badRequest('Invalid company id');
  return withTransaction(async (t) => {
    const cur = await t.query('SELECT active FROM companies WHERE id = $1', [id]);
    if (!cur.rows[0]) throw HttpError.notFound(`Company ${id} not found`);
    if (!cur.rows[0].active) throw HttpError.badRequest('An inactive company cannot be the default');
    await t.query('UPDATE companies SET is_default = FALSE WHERE is_default');
    const { rows } = await t.query(
      `UPDATE companies SET is_default = TRUE, updated_at = now() WHERE id = $1 RETURNING ${COLS}`,
      [id]
    );
    return mapRow(rows[0]);
  });
}

const IN_USE_CHECKS = [
  ['assets', 'asset'], ['employees', 'employee'], ['mobile_lines', 'mobile line'],
  ['licenses', 'license'], ['contracts', 'contract'], ['consumables', 'consumable'],
  ['stock_counts', 'stock count'], ['handovers', 'handover receipt'],
];

/**
 * Refuse to delete a company that still owns anything — a device or a signed
 * receipt with a dangling company is worse than an extra row, and deactivating
 * is the operation people actually want.
 */
async function deleteCompany(id) {
  if (!isUuid(id)) throw HttpError.badRequest('Invalid company id');
  const cur = await query('SELECT is_default, name FROM companies WHERE id = $1', [id]);
  if (!cur.rows[0]) throw HttpError.notFound(`Company ${id} not found`);
  if (cur.rows[0].is_default) throw HttpError.badRequest('The default company cannot be deleted');

  const children = await query('SELECT count(*)::int AS n FROM companies WHERE parent_id = $1', [id]);
  if (children.rows[0].n > 0) {
    throw HttpError.conflict('Move or delete the sub-companies under this company first');
  }
  for (const [table, label] of IN_USE_CHECKS) {
    const { rows } = await query(`SELECT count(*)::int AS n FROM ${table} WHERE company_id = $1`, [id]);
    if (rows[0].n > 0) {
      throw HttpError.conflict(
        `"${cur.rows[0].name}" still owns ${rows[0].n} ${label}${rows[0].n === 1 ? '' : 's'} — `
        + 'move them to another company or deactivate this one instead'
      );
    }
  }
  await query('DELETE FROM companies WHERE id = $1', [id]);
  return { id, deleted: true };
}

/* -------------------------------- Branding --------------------------------- */

/**
 * The effective letterhead for `companyId`: the company's own values, with the
 * group-level app_settings filling every gap. Pass a pre-loaded `settings` when
 * the caller already has one (the PDF builders do) to save a round trip, and a
 * `client` when calling from inside an open transaction — taking a second pool
 * connection while one is held is how a busy pool deadlocks itself.
 */
async function resolveBranding(companyId, settings = null, { client = null } = {}) {
  const run = client ? (sql, params) => client.query(sql, params) : query;
  const s = settings || await require('./settingsService').getSettings();
  const group = {
    companyId: null,
    companyName: s.companyName || 'IT Asset Control Pro',
    companyLogo: s.companyLogo || null,
    companyAddress: s.companyAddress || null,
    handoverTerms: s.handoverTerms || null,
    handoverTemplateId: null,
    taxOffice: null,
    taxNo: null,
  };
  if (!companyId || !isUuid(companyId)) return group;

  const { rows } = await run(
    `SELECT id, name, logo, address, tax_office, tax_no, handover_terms, handover_template_id
       FROM companies WHERE id = $1`,
    [companyId]
  );
  const c = rows[0];
  if (!c) return group;
  return {
    companyId: c.id,
    companyName: c.name || group.companyName,
    companyLogo: c.logo || group.companyLogo,
    companyAddress: c.address || group.companyAddress,
    handoverTerms: c.handover_terms || group.handoverTerms,
    handoverTemplateId: c.handover_template_id || null,
    taxOffice: c.tax_office || null,
    taxNo: c.tax_no || null,
  };
}

/**
 * Keep the default company's name in step with the Settings screen. Legacy
 * behaviour: on a single-company install, renaming the workspace there is the
 * only way anyone ever renamed the company, and the zimmet header must follow.
 * Only the default row, only the name — subsidiaries are renamed in Firmalar.
 */
async function syncDefaultCompanyName(companyName) {
  const name = trimOrNull(companyName, 120);
  if (!name) return;
  await query(
    `UPDATE companies SET name = $1, updated_at = now()
      WHERE is_default AND name <> $1
        AND NOT EXISTS (SELECT 1 FROM companies WHERE lower(name) = lower($1) AND NOT is_default)`,
    [name]
  ).catch(() => { /* a name clash with a subsidiary just leaves the default alone */ });
}

module.exports = {
  listCompanies,
  listCompanyOptions,
  listCompaniesWithCounts,
  getCompany,
  getDefaultCompany,
  createCompany,
  updateCompany,
  setDefaultCompany,
  deleteCompany,
  resolveBranding,
  syncDefaultCompanyName,
};
