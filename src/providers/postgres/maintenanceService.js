/** Maintenance service (postgres) — repair lifecycle, transactional. */
const { query, withTransaction } = require('./pool');
const { mapRows, isUuid } = require('./rowMapper');
const { HttpError } = require('../../utils/httpError');

async function sendToRepair({ assetId, serviceCompany, issueDescription, cost = 0 }, itUser) {
  if (!assetId || !serviceCompany || !issueDescription) {
    throw HttpError.badRequest('assetId, serviceCompany and issueDescription are required');
  }
  if (!isUuid(assetId)) throw HttpError.notFound(`Asset ${assetId} not found`);

  return withTransaction(async (t) => {
    const { rows } = await t.query('SELECT * FROM assets WHERE id = $1 FOR UPDATE', [assetId]);
    const asset = rows[0];
    if (!asset) throw HttpError.notFound(`Asset ${assetId} not found`);
    if (asset.status === 'In Repair') throw HttpError.conflict(`Asset ${asset.asset_tag} is already in repair`);
    if (asset.status === 'Scrap') throw HttpError.conflict(`Asset ${asset.asset_tag} is scrapped and cannot be repaired`);

    const previousEmployee = asset.current_employee_id
      ? { id: asset.current_employee_id, fullName: asset.current_employee_name }
      : null;

    const logRes = await t.query(
      `INSERT INTO maintenance_logs
         (asset_id, asset_tag, service_company, issue_description, cost, previous_status, previous_employee)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb) RETURNING id`,
      [assetId, asset.asset_tag, serviceCompany, issueDescription, Number(cost) || 0,
       asset.status, previousEmployee ? JSON.stringify(previousEmployee) : null]
    );

    await t.query(
      `UPDATE assets SET status = 'In Repair', updated_at = now() WHERE id = $1`,
      [assetId]
    );

    await t.query(
      `INSERT INTO asset_history
         (asset_id, asset_tag, employee_id, employee_name, action_type, notes, changed_by, changed_by_name)
       VALUES ($1, $2, $3, $4, 'sent_to_repair', $5, $6, $7)`,
      [assetId, asset.asset_tag, asset.current_employee_id, asset.current_employee_name,
       `${serviceCompany}: ${issueDescription}`, itUser.uid, itUser.username || itUser.email]
    );

    return { id: logRes.rows[0].id, assetId, assetTag: asset.asset_tag, status: 'In Repair' };
  });
}

async function closeRepair(logId, { cost, resolutionNote, scrap = false } = {}, itUser) {
  if (!isUuid(logId)) throw HttpError.notFound(`Maintenance log ${logId} not found`);

  return withTransaction(async (t) => {
    const logRes = await t.query('SELECT * FROM maintenance_logs WHERE id = $1 FOR UPDATE', [logId]);
    const log = logRes.rows[0];
    if (!log) throw HttpError.notFound(`Maintenance log ${logId} not found`);
    if (log.return_date) throw HttpError.conflict('This maintenance log is already closed');

    const assetRes = await t.query('SELECT * FROM assets WHERE id = $1 FOR UPDATE', [log.asset_id]);
    if (!assetRes.rows[0]) throw HttpError.notFound(`Asset ${log.asset_id} not found`);

    const prevEmployee = log.previous_employee || null;
    const restoredStatus = scrap
      ? 'Scrap'
      : log.previous_status === 'Assigned' && prevEmployee
        ? 'Assigned'
        : 'In Stock';

    await t.query(
      `UPDATE maintenance_logs SET return_date = now(),
              cost = COALESCE($2, cost), resolution_note = COALESCE($3, resolution_note)
       WHERE id = $1`,
      [logId, cost !== undefined ? Number(cost) || 0 : null, resolutionNote || null]
    );

    await t.query(
      `UPDATE assets SET status = $2, current_employee_id = $3, current_employee_name = $4,
              updated_at = now() WHERE id = $1`,
      [log.asset_id, restoredStatus,
       restoredStatus === 'Assigned' ? prevEmployee.id : null,
       restoredStatus === 'Assigned' ? prevEmployee.fullName : null]
    );

    // Scrap (or return to stock) while previously assigned → free the employee slot.
    if (log.previous_status === 'Assigned' && prevEmployee && prevEmployee.id && restoredStatus !== 'Assigned') {
      await t.query(
        'UPDATE employees SET active_asset_count = GREATEST(active_asset_count - 1, 0) WHERE id = $1',
        [prevEmployee.id]
      );
    }

    await t.query(
      `INSERT INTO asset_history
         (asset_id, asset_tag, employee_id, employee_name, action_type, notes, changed_by, changed_by_name)
       VALUES ($1, $2, $3, $4, 'returned', $5, $6, $7)`,
      [log.asset_id, log.asset_tag, prevEmployee ? prevEmployee.id : null,
       prevEmployee ? prevEmployee.fullName : null,
       scrap
         ? `Scrapped after repair. ${resolutionNote || ''}`.trim()
         : `Returned from ${log.service_company}. ${resolutionNote || ''}`.trim(),
       itUser.uid, itUser.username || itUser.email]
    );

    return { id: logId, assetId: log.asset_id, assetTag: log.asset_tag, status: restoredStatus };
  });
}

/** Append a progress note to a repair log; also lands in the asset's history. */
async function addRepairNote(logId, { note }, itUser) {
  if (!note || !String(note).trim()) throw HttpError.badRequest('note is required');
  if (!isUuid(logId)) throw HttpError.notFound(`Maintenance log ${logId} not found`);

  return withTransaction(async (t) => {
    const res = await t.query('SELECT * FROM maintenance_logs WHERE id = $1 FOR UPDATE', [logId]);
    const log = res.rows[0];
    if (!log) throw HttpError.notFound(`Maintenance log ${logId} not found`);

    const entry = {
      note: String(note).trim(),
      by: itUser.username || itUser.email,
      byUid: itUser.uid,
      at: new Date().toISOString(),
    };
    await t.query(
      `UPDATE maintenance_logs SET progress_notes = progress_notes || $2::jsonb WHERE id = $1`,
      [logId, JSON.stringify([entry])]
    );
    await t.query(
      `INSERT INTO asset_history
         (asset_id, asset_tag, employee_id, employee_name, action_type, notes, changed_by, changed_by_name)
       VALUES ($1, $2, $3, $4, 'repair_update', $5, $6, $7)`,
      [log.asset_id, log.asset_tag,
       log.previous_employee ? log.previous_employee.id : null,
       log.previous_employee ? log.previous_employee.fullName : null,
       `${log.service_company}: ${entry.note}`, itUser.uid, itUser.username || itUser.email]
    );
    return { id: logId, assetTag: log.asset_tag, entry };
  });
}

async function listMaintenanceLogs({ open, assetId, limit = 100 } = {}) {
  const where = [];
  const params = [];
  if (assetId) {
    if (!isUuid(assetId)) return [];
    params.push(assetId);
    where.push(`asset_id = $${params.length}`);
  }
  if (open === 'true' || open === true) where.push('return_date IS NULL');
  params.push(Math.min(Number(limit) || 100, 2000));

  const { rows } = await query(
    `SELECT * FROM maintenance_logs ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY sent_date DESC LIMIT $${params.length}`,
    params
  );
  return mapRows(rows);
}

async function getLog(id) {
  if (!isUuid(id)) throw HttpError.notFound(`Maintenance log ${id} not found`);
  const { rows } = await query('SELECT * FROM maintenance_logs WHERE id = $1', [id]);
  if (!rows[0]) throw HttpError.notFound(`Maintenance log ${id} not found`);
  return mapRows(rows)[0];
}

module.exports = { sendToRepair, closeRepair, listMaintenanceLogs, addRepairNote, getLog };
