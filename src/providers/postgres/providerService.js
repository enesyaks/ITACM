/** Providers & contracts — vendor contacts and commercial agreements. */
const { query } = require('./pool');
const { isUuid } = require('./rowMapper');
const { HttpError } = require('../../utils/httpError');
const { DEFAULT_CURRENCY } = require('../../utils/defaults');
const { getSettings } = require('./settingsService');
const { sanitizeHttpUrl } = require('../../utils/httpUrl');

const PROVIDER_STATUSES = new Set(['Active', 'Inactive']);
const CONTRACT_STATUSES = new Set(['Draft', 'Active', 'Expired', 'Cancelled', 'Renewed']);
const BILLING_CYCLES = new Set(['Monthly', 'Quarterly', 'Annual', 'One-time', 'Other']);

async function defaultCostCurrency() {
  try {
    const s = await getSettings();
    return s.currency || DEFAULT_CURRENCY;
  } catch {
    return DEFAULT_CURRENCY;
  }
}

function normalizeCostCurrency(raw, fallback) {
  const s = trimOrNull(raw, 8);
  if (!s) return fallback || DEFAULT_CURRENCY;
  const c = s.toUpperCase();
  if (!/^[A-Z]{3}$/.test(c)) throw HttpError.badRequest('costCurrency must be a 3-letter ISO code');
  return c;
}

function trimOrNull(v, max = 256) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.slice(0, max);
}

function requireCategory(raw, label = 'category') {
  const cat = trimOrNull(raw, 60);
  if (!cat) throw HttpError.badRequest(`${label} is required`);
  return cat;
}

function parseDate(v) {
  if (v == null || v === '') return null;
  const s = String(v).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw HttpError.badRequest(`Invalid date: ${v}`);
  return s;
}

function parseMoney(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw HttpError.badRequest('costAmount must be a non-negative number');
  return n;
}

function parseBool(v, fallback = false) {
  if (v == null || v === '') return fallback;
  if (typeof v === 'boolean') return v;
  const s = String(v).toLowerCase();
  if (s === 'true' || s === '1' || s === 'yes') return true;
  if (s === 'false' || s === '0' || s === 'no') return false;
  return fallback;
}

function mapProvider(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    status: row.status,
    website: row.website,
    phone: row.phone,
    email: row.email,
    supportEmail: row.support_email,
    supportPhone: row.support_phone,
    supportPortal: row.support_portal,
    accountNumber: row.account_number,
    taxId: row.tax_id,
    contactName: row.contact_name,
    contactRole: row.contact_role,
    contactEmail: row.contact_email,
    contactPhone: row.contact_phone,
    notes: row.notes || '',
    contractCount: row.contract_count != null ? Number(row.contract_count) : undefined,
    activeContractCount: row.active_contract_count != null ? Number(row.active_contract_count) : undefined,
    documentCount: row.document_count != null ? Number(row.document_count) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapContract(row) {
  if (!row) return null;
  return {
    id: row.id,
    providerId: row.provider_id,
    providerName: row.provider_name || null,
    providerCategory: row.provider_category || null,
    title: row.title,
    contractNumber: row.contract_number,
    category: row.category,
    status: row.status,
    startDate: row.start_date,
    endDate: row.end_date,
    renewalDate: row.renewal_date,
    noticeDays: row.notice_days,
    autoRenew: !!row.auto_renew,
    costAmount: row.cost_amount != null ? Number(row.cost_amount) : null,
    costCurrency: row.cost_currency || DEFAULT_CURRENCY,
    billingCycle: row.billing_cycle,
    ownerEmployee: row.owner_employee_id
      ? { id: row.owner_employee_id, fullName: row.owner_employee_name }
      : null,
    notes: row.notes || '',
    documentCount: row.document_count != null ? Number(row.document_count) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function listProviders({ status, category, search } = {}) {
  const where = [];
  const params = [];
  if (status && PROVIDER_STATUSES.has(status)) {
    params.push(status);
    where.push(`p.status = $${params.length}`);
  }
  if (category && String(category).trim()) {
    params.push(String(category).trim());
    where.push(`p.category = $${params.length}`);
  }
  if (search && String(search).trim()) {
    params.push(`%${String(search).trim().toLowerCase()}%`);
    const i = params.length;
    where.push(`(
      lower(p.name) LIKE $${i}
      OR lower(coalesce(p.contact_name, '')) LIKE $${i}
      OR lower(coalesce(p.email, '')) LIKE $${i}
      OR lower(coalesce(p.phone, '')) LIKE $${i}
      OR lower(coalesce(p.account_number, '')) LIKE $${i}
    )`);
  }
  const sql = `
    SELECT p.*,
      (SELECT COUNT(*)::int FROM contracts c WHERE c.provider_id = p.id) AS contract_count,
      (SELECT COUNT(*)::int FROM contracts c WHERE c.provider_id = p.id AND c.status = 'Active') AS active_contract_count,
      (SELECT COUNT(*)::int FROM provider_documents d WHERE d.provider_id = p.id) AS document_count
    FROM providers p
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY p.name`;
  const { rows } = await query(sql, params);
  return rows.map(mapProvider);
}

async function getProvider(id) {
  if (!isUuid(id)) throw HttpError.notFound(`Provider ${id} not found`);
  const { rows } = await query(
    `SELECT p.*,
      (SELECT COUNT(*)::int FROM contracts c WHERE c.provider_id = p.id) AS contract_count,
      (SELECT COUNT(*)::int FROM contracts c WHERE c.provider_id = p.id AND c.status = 'Active') AS active_contract_count,
      (SELECT COUNT(*)::int FROM provider_documents d WHERE d.provider_id = p.id) AS document_count
     FROM providers p WHERE p.id = $1`,
    [id]
  );
  if (!rows[0]) throw HttpError.notFound(`Provider ${id} not found`);
  return mapProvider(rows[0]);
}

async function createProvider(body = {}) {
  const name = trimOrNull(body.name, 200);
  if (!name) throw HttpError.badRequest('name is required');
  const category = requireCategory(body.category || 'Other');
  const status = body.status || 'Active';
  if (!PROVIDER_STATUSES.has(status)) throw HttpError.badRequest('Invalid status');

  const { rows } = await query(
    `INSERT INTO providers (
       name, category, status, website, phone, email,
       support_email, support_phone, support_portal,
       account_number, tax_id,
       contact_name, contact_role, contact_email, contact_phone, notes
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     RETURNING *`,
    [
      name, category, status,
      sanitizeHttpUrl(body.website, { max: 500, field: 'website' }),
      trimOrNull(body.phone, 64),
      trimOrNull(body.email, 200),
      trimOrNull(body.supportEmail, 200),
      trimOrNull(body.supportPhone, 64),
      sanitizeHttpUrl(body.supportPortal, { max: 500, field: 'supportPortal' }),
      trimOrNull(body.accountNumber, 128),
      trimOrNull(body.taxId, 64),
      trimOrNull(body.contactName, 200),
      trimOrNull(body.contactRole, 120),
      trimOrNull(body.contactEmail, 200),
      trimOrNull(body.contactPhone, 64),
      trimOrNull(body.notes, 4000) || '',
    ]
  );
  return mapProvider({ ...rows[0], contract_count: 0, active_contract_count: 0 });
}

async function updateProvider(id, body = {}) {
  if (!isUuid(id)) throw HttpError.notFound(`Provider ${id} not found`);
  const cur = await getProvider(id);
  const name = body.name !== undefined ? trimOrNull(body.name, 200) : cur.name;
  if (!name) throw HttpError.badRequest('name is required');
  const category = body.category !== undefined ? requireCategory(body.category) : cur.category;
  const status = body.status !== undefined ? body.status : cur.status;
  if (!PROVIDER_STATUSES.has(status)) throw HttpError.badRequest('Invalid status');

  const pick = (key, curKey, max) =>
    (body[key] !== undefined ? trimOrNull(body[key], max) : cur[curKey]);
  const pickUrl = (key, curKey) =>
    (body[key] !== undefined
      ? sanitizeHttpUrl(body[key], { max: 500, field: key })
      : cur[curKey]);

  const { rows } = await query(
    `UPDATE providers SET
       name = $2, category = $3, status = $4,
       website = $5, phone = $6, email = $7,
       support_email = $8, support_phone = $9, support_portal = $10,
       account_number = $11, tax_id = $12,
       contact_name = $13, contact_role = $14, contact_email = $15, contact_phone = $16,
       notes = $17, updated_at = now()
     WHERE id = $1 RETURNING *`,
    [
      id, name, category, status,
      pickUrl('website', 'website'),
      pick('phone', 'phone', 64),
      pick('email', 'email', 200),
      pick('supportEmail', 'supportEmail', 200),
      pick('supportPhone', 'supportPhone', 64),
      pickUrl('supportPortal', 'supportPortal'),
      pick('accountNumber', 'accountNumber', 128),
      pick('taxId', 'taxId', 64),
      pick('contactName', 'contactName', 200),
      pick('contactRole', 'contactRole', 120),
      pick('contactEmail', 'contactEmail', 200),
      pick('contactPhone', 'contactPhone', 64),
      body.notes !== undefined ? (trimOrNull(body.notes, 4000) || '') : cur.notes,
    ]
  );
  return mapProvider({
    ...rows[0],
    contract_count: cur.contractCount,
    active_contract_count: cur.activeContractCount,
  });
}

async function deleteProvider(id) {
  if (!isUuid(id)) throw HttpError.notFound(`Provider ${id} not found`);
  const { rows: linked } = await query(
    'SELECT COUNT(*)::int AS n FROM contracts WHERE provider_id = $1',
    [id]
  );
  if (linked[0].n > 0) {
    throw HttpError.conflict(
      `Cannot delete provider — ${linked[0].n} contract(s) still linked. Remove or reassign them first.`
    );
  }
  const { rowCount } = await query('DELETE FROM providers WHERE id = $1', [id]);
  if (!rowCount) throw HttpError.notFound(`Provider ${id} not found`);
  return { id, deleted: true };
}

async function resolveOwner(employeeId) {
  if (!employeeId) return { id: null, name: null };
  if (!isUuid(employeeId)) throw HttpError.badRequest('Invalid ownerEmployeeId');
  const { rows } = await query(
    'SELECT id, full_name FROM employees WHERE id = $1',
    [employeeId]
  );
  if (!rows[0]) throw HttpError.badRequest('Owner employee not found');
  return { id: rows[0].id, name: rows[0].full_name };
}

async function listContracts({ status, providerId, search, expiringWithinDays } = {}) {
  const where = [];
  const params = [];
  if (status && CONTRACT_STATUSES.has(status)) {
    params.push(status);
    where.push(`c.status = $${params.length}`);
  }
  if (providerId) {
    if (!isUuid(providerId)) throw HttpError.badRequest('Invalid providerId');
    params.push(providerId);
    where.push(`c.provider_id = $${params.length}`);
  }
  if (search && String(search).trim()) {
    params.push(`%${String(search).trim().toLowerCase()}%`);
    const i = params.length;
    where.push(`(
      lower(c.title) LIKE $${i}
      OR lower(coalesce(c.contract_number, '')) LIKE $${i}
      OR lower(p.name) LIKE $${i}
    )`);
  }
  if (expiringWithinDays != null && expiringWithinDays !== '') {
    const days = Number(expiringWithinDays);
    if (!Number.isInteger(days) || days < 0) {
      throw HttpError.badRequest('expiringWithinDays must be a non-negative integer');
    }
    params.push(days);
    where.push(`c.end_date IS NOT NULL
      AND c.end_date >= CURRENT_DATE
      AND c.end_date <= CURRENT_DATE + ($${params.length}::int * INTERVAL '1 day')
      AND c.status IN ('Active', 'Draft')`);
  }
  const sql = `
    SELECT c.*, p.name AS provider_name, p.category AS provider_category,
      (SELECT COUNT(*)::int FROM contract_documents d WHERE d.contract_id = c.id) AS document_count
    FROM contracts c
    JOIN providers p ON p.id = c.provider_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY
      CASE WHEN c.end_date IS NULL THEN 1 ELSE 0 END,
      c.end_date ASC NULLS LAST,
      c.title`;
  const { rows } = await query(sql, params);
  return rows.map(mapContract);
}

async function getContract(id) {
  if (!isUuid(id)) throw HttpError.notFound(`Contract ${id} not found`);
  const { rows } = await query(
    `SELECT c.*, p.name AS provider_name, p.category AS provider_category,
      (SELECT COUNT(*)::int FROM contract_documents d WHERE d.contract_id = c.id) AS document_count
     FROM contracts c
     JOIN providers p ON p.id = c.provider_id
     WHERE c.id = $1`,
    [id]
  );
  if (!rows[0]) throw HttpError.notFound(`Contract ${id} not found`);
  return mapContract(rows[0]);
}

async function createContract(body = {}) {
  const title = trimOrNull(body.title, 300);
  if (!title) throw HttpError.badRequest('title is required');
  if (!body.providerId || !isUuid(body.providerId)) {
    throw HttpError.badRequest('providerId is required');
  }
  await getProvider(body.providerId);

  const category = requireCategory(body.category || 'Other');
  const status = body.status || 'Active';
  if (!CONTRACT_STATUSES.has(status)) throw HttpError.badRequest('Invalid status');
  const billingCycle = body.billingCycle || 'Annual';
  if (!BILLING_CYCLES.has(billingCycle)) throw HttpError.badRequest('Invalid billingCycle');

  const owner = await resolveOwner(body.ownerEmployeeId);
  const fallbackCur = await defaultCostCurrency();

  const { rows } = await query(
    `INSERT INTO contracts (
       provider_id, title, contract_number, category, status,
       start_date, end_date, renewal_date, notice_days, auto_renew,
       cost_amount, cost_currency, billing_cycle,
       owner_employee_id, owner_employee_name, notes
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     RETURNING *`,
    [
      body.providerId,
      title,
      trimOrNull(body.contractNumber, 128),
      category,
      status,
      parseDate(body.startDate),
      parseDate(body.endDate),
      parseDate(body.renewalDate),
      body.noticeDays === '' || body.noticeDays == null ? null : Number(body.noticeDays),
      parseBool(body.autoRenew, false),
      parseMoney(body.costAmount),
      normalizeCostCurrency(body.costCurrency, fallbackCur),
      billingCycle,
      owner.id,
      owner.name,
      trimOrNull(body.notes, 4000) || '',
    ]
  );
  const { rows: p } = await query('SELECT name, category FROM providers WHERE id = $1', [body.providerId]);
  return mapContract({
    ...rows[0],
    provider_name: p[0].name,
    provider_category: p[0].category,
  });
}

async function updateContract(id, body = {}) {
  const cur = await getContract(id);
  const title = body.title !== undefined ? trimOrNull(body.title, 300) : cur.title;
  if (!title) throw HttpError.badRequest('title is required');

  let providerId = cur.providerId;
  if (body.providerId !== undefined) {
    if (!isUuid(body.providerId)) throw HttpError.badRequest('Invalid providerId');
    await getProvider(body.providerId);
    providerId = body.providerId;
  }

  const category = body.category !== undefined ? requireCategory(body.category) : cur.category;
  const status = body.status !== undefined ? body.status : cur.status;
  if (!CONTRACT_STATUSES.has(status)) throw HttpError.badRequest('Invalid status');
  const billingCycle = body.billingCycle !== undefined ? body.billingCycle : cur.billingCycle;
  if (!BILLING_CYCLES.has(billingCycle)) throw HttpError.badRequest('Invalid billingCycle');

  let ownerId = cur.ownerEmployee ? cur.ownerEmployee.id : null;
  let ownerName = cur.ownerEmployee ? cur.ownerEmployee.fullName : null;
  if (body.ownerEmployeeId !== undefined) {
    const owner = await resolveOwner(body.ownerEmployeeId || null);
    ownerId = owner.id;
    ownerName = owner.name;
  }

  const { rows } = await query(
    `UPDATE contracts SET
       provider_id = $2, title = $3, contract_number = $4, category = $5, status = $6,
       start_date = $7, end_date = $8, renewal_date = $9, notice_days = $10, auto_renew = $11,
       cost_amount = $12, cost_currency = $13, billing_cycle = $14,
       owner_employee_id = $15, owner_employee_name = $16, notes = $17, updated_at = now()
     WHERE id = $1 RETURNING *`,
    [
      id,
      providerId,
      title,
      body.contractNumber !== undefined ? trimOrNull(body.contractNumber, 128) : cur.contractNumber,
      category,
      status,
      body.startDate !== undefined ? parseDate(body.startDate) : (cur.startDate ? String(cur.startDate).slice(0, 10) : null),
      body.endDate !== undefined ? parseDate(body.endDate) : (cur.endDate ? String(cur.endDate).slice(0, 10) : null),
      body.renewalDate !== undefined ? parseDate(body.renewalDate) : (cur.renewalDate ? String(cur.renewalDate).slice(0, 10) : null),
      body.noticeDays !== undefined
        ? (body.noticeDays === '' || body.noticeDays == null ? null : Number(body.noticeDays))
        : cur.noticeDays,
      body.autoRenew !== undefined ? parseBool(body.autoRenew, false) : cur.autoRenew,
      body.costAmount !== undefined ? parseMoney(body.costAmount) : cur.costAmount,
      body.costCurrency !== undefined
        ? normalizeCostCurrency(body.costCurrency, cur.costCurrency || DEFAULT_CURRENCY)
        : cur.costCurrency,
      billingCycle,
      ownerId,
      ownerName,
      body.notes !== undefined ? (trimOrNull(body.notes, 4000) || '') : cur.notes,
    ]
  );
  const { rows: p } = await query('SELECT name, category FROM providers WHERE id = $1', [providerId]);
  return mapContract({
    ...rows[0],
    provider_name: p[0].name,
    provider_category: p[0].category,
  });
}

async function deleteContract(id) {
  if (!isUuid(id)) throw HttpError.notFound(`Contract ${id} not found`);
  const { rowCount } = await query('DELETE FROM contracts WHERE id = $1', [id]);
  if (!rowCount) throw HttpError.notFound(`Contract ${id} not found`);
  return { id, deleted: true };
}

async function summary() {
  const [{ rows: p }, { rows: c }, { rows: soon }] = await Promise.all([
    query(`SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status = 'Active')::int AS active
      FROM providers`),
    query(`SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status = 'Active')::int AS active,
      COUNT(*) FILTER (WHERE status = 'Expired')::int AS expired
      FROM contracts`),
    query(`SELECT COUNT(*)::int AS n FROM contracts
      WHERE status IN ('Active', 'Draft')
        AND end_date IS NOT NULL
        AND end_date >= CURRENT_DATE
        AND end_date <= CURRENT_DATE + INTERVAL '60 days'`),
  ]);
  return {
    providers: p[0],
    contracts: c[0],
    expiringWithin60Days: soon[0].n,
  };
}

module.exports = {
  listProviders,
  getProvider,
  createProvider,
  updateProvider,
  deleteProvider,
  listContracts,
  getContract,
  createContract,
  updateContract,
  deleteContract,
  summary,
};
