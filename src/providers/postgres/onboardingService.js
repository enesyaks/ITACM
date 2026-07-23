/**
 * Employee onboarding — schedule start date, reserve stock, complete into zimmet.
 */
const { query, withTransaction } = require('./pool');
const { mapRow, mapRows, isUuid } = require('./rowMapper');
const { HttpError } = require('../../utils/httpError');
const { executeHandover } = require('./handoverService');
const auditService = require('./auditService');

const INFRA_CATS = new Set(['Network', 'Server']);

function actor(itUser) {
  return {
    id: (itUser && (itUser.uid || itUser.id)) || 'system',
    name: (itUser && (itUser.username || itUser.email)) || 'system',
  };
}

function parseDateOnly(v) {
  if (!v) return null;
  const s = String(v).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw HttpError.badRequest('startDate must be YYYY-MM-DD');
  }
  return s;
}

function normalizeItems(assets = [], lines = []) {
  const assetItems = (Array.isArray(assets) ? assets : [])
    .filter((x) => x && (x.assetId || x.id))
    .map((x) => ({
      assetId: x.assetId || x.id,
      conditionNote: String(x.conditionNote || x.note || '').trim().slice(0, 500),
    }));
  const lineItems = (Array.isArray(lines) ? lines : [])
    .filter((x) => x && (x.lineId || x.id))
    .map((x) => ({
      lineId: x.lineId || x.id,
      conditionNote: String(x.conditionNote || x.note || '').trim().slice(0, 500),
    }));
  const assetIds = assetItems.map((i) => i.assetId);
  const lineIds = lineItems.map((i) => i.lineId);
  if (new Set(assetIds).size !== assetIds.length) {
    throw HttpError.badRequest('Duplicate assets in onboarding basket');
  }
  if (new Set(lineIds).size !== lineIds.length) {
    throw HttpError.badRequest('Duplicate lines in onboarding basket');
  }
  if (assetIds.length && !assetIds.every(isUuid)) throw HttpError.badRequest('Invalid assetId');
  if (lineIds.length && !lineIds.every(isUuid)) throw HttpError.badRequest('Invalid lineId');
  return { assetItems, lineItems };
}

async function loadOnboardingRow(t, id, { forUpdate = false } = {}) {
  if (!isUuid(id)) throw HttpError.notFound(`Onboarding ${id} not found`);
  const sql = forUpdate
    ? 'SELECT * FROM employee_onboardings WHERE id = $1 FOR UPDATE'
    : 'SELECT * FROM employee_onboardings WHERE id = $1';
  const { rows } = await t.query(sql, [id]);
  if (!rows[0]) throw HttpError.notFound(`Onboarding ${id} not found`);
  return rows[0];
}

async function fetchItems(tOrQuery, onboardingId) {
  const q = tOrQuery.query ? tOrQuery.query.bind(tOrQuery) : query;
  const { rows } = await q(
    `SELECT oi.*,
            a.asset_tag, a.brand, a.model, a.category, a.serial_number, a.status AS asset_status,
            l.phone_number, l.operator, l.plan, l.status AS line_status
     FROM onboarding_items oi
     LEFT JOIN assets a ON a.id = oi.asset_id
     LEFT JOIN mobile_lines l ON l.id = oi.line_id
     WHERE oi.onboarding_id = $1
     ORDER BY oi.created_at`,
    [onboardingId]
  );
  return rows.map((r) => {
    const base = mapRow(r);
    if (r.asset_id) {
      return {
        id: base.id,
        kind: 'asset',
        assetId: r.asset_id,
        assetTag: r.asset_tag,
        brand: r.brand,
        model: r.model,
        category: r.category,
        serialNumber: r.serial_number,
        status: r.asset_status,
        conditionNote: base.conditionNote || '',
      };
    }
    return {
      id: base.id,
      kind: 'line',
      lineId: r.line_id,
      phoneNumber: r.phone_number,
      operator: r.operator,
      plan: r.plan,
      status: r.line_status,
      conditionNote: base.conditionNote || '',
    };
  });
}

/**
 * The HR ticket this onboarding was provisioned from, if any.
 *
 * IT prepares the kit from this list, so the equipment HR asked for has to
 * travel with the onboarding rather than staying buried in a closed ticket.
 * Tolerates a database without the hr_* tables (older deployments).
 */
async function fetchHrRequest(onboardingId) {
  try {
    const { rows } = await query(
      `SELECT id, notes, created_by_name, fulfilled_at
         FROM hr_requests WHERE onboarding_id = $1 LIMIT 1`,
      [onboardingId]
    );
    if (!rows[0]) return null;
    const { rows: itemRows } = await query(
      'SELECT category, qty FROM hr_request_items WHERE request_id = $1 ORDER BY category',
      [rows[0].id]
    );
    return {
      id: rows[0].id,
      requestedBy: rows[0].created_by_name || null,
      notes: rows[0].notes || '',
      fulfilledAt: rows[0].fulfilled_at || null,
      items: itemRows.map((r) => ({ category: r.category, qty: r.qty })),
    };
  } catch {
    return null;
  }
}

async function enrichOnboarding(row, items) {
  const [emp, hrRequest] = await Promise.all([
    query('SELECT * FROM employees WHERE id = $1', [row.employee_id]),
    fetchHrRequest(row.id),
  ]);
  return {
    ...mapRow(row),
    employee: emp.rows[0] ? mapRow(emp.rows[0]) : null,
    items,
    itemCount: items.length,
    hrRequest,
  };
}

async function reserveAsset(t, asset, employee, note, itUser) {
  if (INFRA_CATS.has(asset.category)) {
    throw HttpError.badRequest(`${asset.asset_tag} is Network/Server — cannot reserve for personal onboarding`);
  }
  if (asset.status !== 'In Stock') {
    throw HttpError.conflict(`${asset.asset_tag} is "${asset.status}" — only In Stock can be reserved`);
  }
  await t.query(
    `UPDATE assets SET status = 'Reserved', updated_at = now() WHERE id = $1`,
    [asset.id]
  );
  const a = actor(itUser);
  await t.query(
    `INSERT INTO asset_history
       (asset_id, asset_tag, employee_id, employee_name, action_type, notes, changed_by, changed_by_name)
     VALUES ($1,$2,$3,$4,'status_changed',$5,$6,$7)`,
    [
      asset.id, asset.asset_tag, employee.id, employee.full_name,
      `Onboarding reserve · In Stock → Reserved${note ? ` · ${note}` : ''}`,
      a.id, a.name,
    ]
  );
}

async function releaseAsset(t, assetId, itUser, reason = 'Onboarding release') {
  const { rows } = await t.query('SELECT * FROM assets WHERE id = $1 FOR UPDATE', [assetId]);
  const asset = rows[0];
  if (!asset) return;
  if (asset.status !== 'Reserved') return;
  await t.query(
    `UPDATE assets SET status = 'In Stock', updated_at = now() WHERE id = $1`,
    [asset.id]
  );
  const a = actor(itUser);
  await t.query(
    `INSERT INTO asset_history
       (asset_id, asset_tag, employee_id, employee_name, action_type, notes, changed_by, changed_by_name)
     VALUES ($1,$2,NULL,NULL,'status_changed',$3,$4,$5)`,
    [asset.id, asset.asset_tag, `${reason} · Reserved → In Stock`, a.id, a.name]
  );
}

async function reserveLine(t, line, employee) {
  if (line.current_employee_id) {
    throw HttpError.conflict(`Line ${line.phone_number} is already assigned`);
  }
  if (line.status !== 'Active') {
    throw HttpError.conflict(`Line ${line.phone_number} status is "${line.status}"`);
  }
  if (line.reserved_for_employee_id && line.reserved_for_employee_id !== employee.id) {
    throw HttpError.conflict(`Line ${line.phone_number} is reserved for another employee`);
  }
  await t.query(
    `UPDATE mobile_lines SET reserved_for_employee_id = $2, updated_at = now() WHERE id = $1`,
    [line.id, employee.id]
  );
}

async function releaseLine(t, lineId) {
  await t.query(
    `UPDATE mobile_lines SET reserved_for_employee_id = NULL, updated_at = now()
     WHERE id = $1 AND reserved_for_employee_id IS NOT NULL`,
    [lineId]
  );
}

async function upsertEmployee(t, body) {
  const startDate = parseDateOnly(body.startDate);
  if (!startDate) throw HttpError.badRequest('startDate is required');

  if (body.employeeId) {
    if (!isUuid(body.employeeId)) throw HttpError.badRequest('Invalid employeeId');
    const { rows } = await t.query('SELECT * FROM employees WHERE id = $1 FOR UPDATE', [body.employeeId]);
    if (!rows[0]) throw HttpError.notFound('Employee not found');
    if (rows[0].status !== 'Active') {
      throw HttpError.conflict(`${rows[0].full_name} is inactive`);
    }
    await t.query('UPDATE employees SET start_date = $2 WHERE id = $1', [rows[0].id, startDate]);
    const refreshed = await t.query('SELECT * FROM employees WHERE id = $1', [rows[0].id]);
    return refreshed.rows[0];
  }

  const fullName = String(body.fullName || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  if (!fullName || !email) throw HttpError.badRequest('fullName and email are required for a new employee');
  try {
    const { rows } = await t.query(
      `INSERT INTO employees (full_name, email, department, title, status, start_date)
       VALUES ($1,$2,$3,$4,'Active',$5) RETURNING *`,
      [fullName, email, body.department || null, body.title || null, startDate]
    );
    return rows[0];
  } catch (err) {
    if (err.code === '23505') throw HttpError.conflict(`An employee with email ${email} already exists`);
    throw err;
  }
}

async function addItemsTx(t, onboarding, employee, assetItems, lineItems, itUser) {
  if (assetItems.length) {
    const { rows } = await t.query(
      'SELECT * FROM assets WHERE id = ANY($1::uuid[]) FOR UPDATE',
      [assetItems.map((i) => i.assetId)]
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const item of assetItems) {
      const asset = byId.get(item.assetId);
      if (!asset) throw HttpError.notFound(`Asset ${item.assetId} not found`);
      await reserveAsset(t, asset, employee, item.conditionNote, itUser);
      await t.query(
        `INSERT INTO onboarding_items (onboarding_id, asset_id, condition_note)
         VALUES ($1,$2,$3)`,
        [onboarding.id, asset.id, item.conditionNote]
      );
    }
  }
  if (lineItems.length) {
    const { rows } = await t.query(
      'SELECT * FROM mobile_lines WHERE id = ANY($1::uuid[]) FOR UPDATE',
      [lineItems.map((i) => i.lineId)]
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const item of lineItems) {
      const line = byId.get(item.lineId);
      if (!line) throw HttpError.notFound(`Line ${item.lineId} not found`);
      await reserveLine(t, line, employee);
      await t.query(
        `INSERT INTO onboarding_items (onboarding_id, line_id, condition_note)
         VALUES ($1,$2,$3)`,
        [onboarding.id, line.id, item.conditionNote]
      );
    }
  }
}

async function createOnboarding(body, itUser) {
  const startDate = parseDateOnly(body.startDate);
  if (!startDate) throw HttpError.badRequest('startDate is required');
  const { assetItems, lineItems } = normalizeItems(body.assets || body.items, body.lines);
  const a = actor(itUser);
  const notes = String(body.notes || '').trim().slice(0, 2000);

  const ob = await withTransaction(async (t) => {
    const employee = await upsertEmployee(t, body);
    const existing = await t.query(
      `SELECT id FROM employee_onboardings
       WHERE employee_id = $1 AND status = 'scheduled'`,
      [employee.id]
    );
    if (existing.rows[0]) {
      throw HttpError.conflict('This employee already has a scheduled onboarding');
    }

    const { rows } = await t.query(
      `INSERT INTO employee_onboardings
         (employee_id, start_date, status, notes, created_by, created_by_name)
       VALUES ($1,$2,'scheduled',$3,$4,$5) RETURNING *`,
      [employee.id, startDate, notes, a.id, a.name]
    );
    const onboarding = rows[0];
    await addItemsTx(t, onboarding, employee, assetItems, lineItems, itUser);
    return onboarding;
  });

  const items = await fetchItems(query, ob.id);
  const data = await enrichOnboarding(ob, items);
  try {
    await auditService.logEvent({
      action: 'employee.onboard.schedule',
      source: 'employees',
      summary: `Scheduled onboarding for ${data.employee?.fullName || ob.employee_id} on ${startDate}`,
      entityType: 'employee',
      entityId: ob.employee_id,
      actorId: a.id,
      actorEmail: (itUser && itUser.email) || null,
      actorName: a.name,
      meta: { onboardingId: ob.id, itemCount: items.length },
    });
  } catch { /* ignore */ }
  return data;
}

async function listOnboardings({ due = false, status, employeeId, limit = 50 } = {}) {
  const where = [];
  const params = [];
  if (due) {
    where.push(`o.status = 'scheduled'`);
    where.push(`o.start_date <= CURRENT_DATE`);
  } else if (status) {
    params.push(status);
    where.push(`o.status = $${params.length}`);
  }
  if (employeeId) {
    if (!isUuid(employeeId)) return [];
    params.push(employeeId);
    where.push(`o.employee_id = $${params.length}`);
  }
  params.push(Math.min(Number(limit) || 50, 200));
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { rows } = await query(
    `SELECT o.*, e.full_name, e.email, e.department, e.title, e.status AS employee_status,
            (SELECT COUNT(*)::int FROM onboarding_items oi WHERE oi.onboarding_id = o.id) AS item_count
     FROM employee_onboardings o
     JOIN employees e ON e.id = o.employee_id
     ${whereSql}
     ORDER BY o.start_date ASC, e.full_name ASC
     LIMIT $${params.length}`,
    params
  );
  return rows.map((r) => ({
    ...mapRow(r),
    employee: {
      id: r.employee_id,
      fullName: r.full_name,
      email: r.email,
      department: r.department,
      title: r.title,
      status: r.employee_status,
    },
    itemCount: r.item_count,
  }));
}

async function getOnboarding(id) {
  const { rows } = await query('SELECT * FROM employee_onboardings WHERE id = $1', [id]);
  if (!rows[0]) throw HttpError.notFound(`Onboarding ${id} not found`);
  const items = await fetchItems(query, id);
  return enrichOnboarding(rows[0], items);
}

async function addItems(onboardingId, body, itUser) {
  const { assetItems, lineItems } = normalizeItems(body.assets || body.items, body.lines);
  if (!assetItems.length && !lineItems.length) {
    throw HttpError.badRequest('No assets or lines to add');
  }

  await withTransaction(async (t) => {
    const ob = await loadOnboardingRow(t, onboardingId, { forUpdate: true });
    if (ob.status !== 'scheduled') {
      throw HttpError.conflict('Only scheduled onboardings can accept new items');
    }
    const empRes = await t.query('SELECT * FROM employees WHERE id = $1 FOR UPDATE', [ob.employee_id]);
    const employee = empRes.rows[0];
    if (!employee || employee.status !== 'Active') {
      throw HttpError.conflict('Employee is inactive');
    }
    await addItemsTx(t, ob, employee, assetItems, lineItems, itUser);
  });

  return getOnboarding(onboardingId);
}

async function removeItem(onboardingId, itemId, itUser) {
  if (!isUuid(itemId)) throw HttpError.notFound('Item not found');
  await withTransaction(async (t) => {
    const ob = await loadOnboardingRow(t, onboardingId, { forUpdate: true });
    if (ob.status !== 'scheduled') {
      throw HttpError.conflict('Only scheduled onboardings can remove items');
    }
    const { rows } = await t.query(
      'SELECT * FROM onboarding_items WHERE id = $1 AND onboarding_id = $2 FOR UPDATE',
      [itemId, onboardingId]
    );
    const item = rows[0];
    if (!item) throw HttpError.notFound('Item not found');
    if (item.asset_id) await releaseAsset(t, item.asset_id, itUser, 'Removed from onboarding');
    if (item.line_id) await releaseLine(t, item.line_id);
    await t.query('DELETE FROM onboarding_items WHERE id = $1', [itemId]);
  });
  return getOnboarding(onboardingId);
}

async function completeOnboarding(onboardingId, body, itUser) {
  const detail = await getOnboarding(onboardingId);
  if (detail.status !== 'scheduled') {
    throw HttpError.conflict('Onboarding is not scheduled');
  }
  if (!detail.items.length) {
    throw HttpError.badRequest('Add at least one device or line before creating the zimmet document');
  }
  if (detail.employee?.status !== 'Active') {
    throw HttpError.conflict('Employee is inactive');
  }

  const assets = detail.items
    .filter((i) => i.kind === 'asset')
    .map((i) => ({ assetId: i.assetId, conditionNote: i.conditionNote }));
  const lines = detail.items
    .filter((i) => i.kind === 'line')
    .map((i) => ({ lineId: i.lineId, conditionNote: i.conditionNote }));

  const receipt = await executeHandover(
    {
      employeeId: detail.employeeId,
      documentType: body.documentType || 'single',
      templateId: body.templateId || null,
      items: assets,
      lines,
    },
    itUser,
    { allowReservedForEmployeeId: detail.employeeId }
  );

  await withTransaction(async (t) => {
    const ob = await loadOnboardingRow(t, onboardingId, { forUpdate: true });
    if (ob.status !== 'scheduled') {
      throw HttpError.conflict('Onboarding changed during complete');
    }
    // Clear line reservation flags (assignment already set by handover).
    await t.query(
      `UPDATE mobile_lines SET reserved_for_employee_id = NULL, updated_at = now()
       WHERE id IN (SELECT line_id FROM onboarding_items WHERE onboarding_id = $1 AND line_id IS NOT NULL)`,
      [onboardingId]
    );
    await t.query(
      `UPDATE employee_onboardings
       SET status = 'completed', completed_at = now(), handover_id = $2
       WHERE id = $1`,
      [onboardingId, receipt.handoverId]
    );
  });

  // Close the loop back to the HR ticket that asked for this, so HR can tell
  // "IT picked it up" apart from "the person actually has their kit".
  //
  // Deliberately AFTER the transaction: a failure here (e.g. a database without
  // the hr_* tables) must not abort and roll back a handover that already
  // happened — inside a transaction the first error poisons every later
  // statement regardless of any catch.
  await query(
    `UPDATE hr_requests
        SET fulfilled_at = now(), fulfilled_handover_id = $2
      WHERE onboarding_id = $1 AND fulfilled_at IS NULL`,
    [onboardingId, receipt.handoverId]
  ).catch(() => {});

  const a = actor(itUser);
  try {
    await auditService.logEvent({
      action: 'employee.onboard.complete',
      source: 'employees',
      summary: `Completed onboarding zimmet for ${detail.employee?.fullName || detail.employeeId}`,
      entityType: 'employee',
      entityId: detail.employeeId,
      actorId: a.id,
      actorEmail: (itUser && itUser.email) || null,
      actorName: a.name,
      meta: { onboardingId, handoverId: receipt.handoverId },
    });
  } catch { /* ignore */ }

  return {
    onboarding: await getOnboarding(onboardingId),
    handover: receipt,
  };
}

async function cancelOnboarding(onboardingId, itUser) {
  await withTransaction(async (t) => {
    const ob = await loadOnboardingRow(t, onboardingId, { forUpdate: true });
    if (ob.status !== 'scheduled') {
      throw HttpError.conflict('Only scheduled onboardings can be cancelled');
    }
    const { rows: items } = await t.query(
      'SELECT * FROM onboarding_items WHERE onboarding_id = $1',
      [onboardingId]
    );
    for (const item of items) {
      if (item.asset_id) await releaseAsset(t, item.asset_id, itUser, 'Onboarding cancelled');
      if (item.line_id) await releaseLine(t, item.line_id);
    }
    await t.query(
      `UPDATE employee_onboardings SET status = 'cancelled' WHERE id = $1`,
      [onboardingId]
    );
  });

  const a = actor(itUser);
  const data = await getOnboarding(onboardingId);
  try {
    await auditService.logEvent({
      action: 'employee.onboard.cancel',
      source: 'employees',
      summary: `Cancelled onboarding for ${data.employee?.fullName || data.employeeId}`,
      entityType: 'employee',
      entityId: data.employeeId,
      actorId: a.id,
      actorEmail: (itUser && itUser.email) || null,
      actorName: a.name,
      meta: { onboardingId },
    });
  } catch { /* ignore */ }
  return data;
}

module.exports = {
  createOnboarding,
  listOnboardings,
  getOnboarding,
  addItems,
  removeItem,
  completeOnboarding,
  cancelOnboarding,
};
