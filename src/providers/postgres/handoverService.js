/**
 * Handover service (postgres) — the atomic Handover Basket.
 *
 * One SQL transaction with SELECT ... FOR UPDATE row locks:
 * validate every basket asset is "In Stock" (and lines are free/Active),
 * create the receipt, flip assets to "Assigned", assign mobile lines,
 * bump the employee counter, append audit rows. Any conflict throws →
 * ROLLBACK. Row locks make concurrent baskets over the same laptop/line
 * impossible.
 */
const { query, withTransaction } = require('./pool');
const { mapRow, mapRows, isUuid } = require('./rowMapper');
const { HttpError } = require('../../utils/httpError');

const MAX_BASKET_SIZE = 100;

async function executeHandover({ employeeId, documentType = 'single', items = [], lines = [], templateId = null }, itUser, opts = {}) {
  const allowReservedForEmployeeId = opts.allowReservedForEmployeeId || null;
  if (!employeeId || !isUuid(employeeId)) throw HttpError.badRequest('A valid employeeId is required');
  if (!['single', 'separate'].includes(documentType)) {
    throw HttpError.badRequest('documentType must be "single" or "separate"');
  }

  const assetItems = (Array.isArray(items) ? items : []).filter((i) => i && i.assetId);
  // Accept lines as a top-level array, or mixed into items as { lineId }.
  const lineItems = [
    ...(Array.isArray(lines) ? lines : []),
    ...(Array.isArray(items) ? items : []).filter((i) => i && i.lineId && !i.assetId),
  ];

  if (assetItems.length === 0 && lineItems.length === 0) {
    throw HttpError.badRequest('The handover basket is empty');
  }
  if (assetItems.length + lineItems.length > MAX_BASKET_SIZE) {
    throw HttpError.badRequest(`Basket exceeds the maximum of ${MAX_BASKET_SIZE} items`);
  }

  const assetIds = assetItems.map((i) => i.assetId);
  if (new Set(assetIds).size !== assetIds.length) {
    throw HttpError.badRequest('Duplicate assets in the basket');
  }
  if (assetIds.length && !assetIds.every(isUuid)) {
    throw HttpError.badRequest('Basket contains an invalid assetId');
  }

  const lineIds = lineItems.map((i) => i.lineId);
  if (new Set(lineIds).size !== lineIds.length) {
    throw HttpError.badRequest('Duplicate mobile lines in the basket');
  }
  if (lineIds.length && !lineIds.every(isUuid)) {
    throw HttpError.badRequest('Basket contains an invalid lineId');
  }

  return withTransaction(async (t) => {
    const empRes = await t.query('SELECT * FROM employees WHERE id = $1 FOR UPDATE', [employeeId]);
    const employee = empRes.rows[0];
    if (!employee) throw HttpError.notFound(`Employee ${employeeId} not found`);
    if (employee.status !== 'Active') {
      throw HttpError.conflict(`Employee ${employee.full_name} is inactive — cannot receive assets`);
    }

    const conflicts = [];
    const byAsset = new Map();
    if (assetIds.length) {
      const assetRes = await t.query(
        'SELECT * FROM assets WHERE id = ANY($1::uuid[]) FOR UPDATE',
        [assetIds]
      );
      assetRes.rows.forEach((a) => byAsset.set(a.id, a));
      for (const item of assetItems) {
        const asset = byAsset.get(item.assetId);
        if (!asset) {
          conflicts.push({ assetId: item.assetId, reason: 'Asset no longer exists' });
        } else if (asset.category === 'Network' || asset.category === 'Server') {
          conflicts.push({
            assetId: asset.id,
            assetTag: asset.asset_tag,
            reason: 'Network/Server equipment is managed via location + responsible person (not personal handover)',
          });
        } else if (asset.status === 'In Stock') {
          /* ok */
        } else if (
          asset.status === 'Reserved'
          && allowReservedForEmployeeId
          && allowReservedForEmployeeId === employee.id
        ) {
          /* onboarding complete may consume Reserved stock for this employee */
        } else {
          conflicts.push({
            assetId: asset.id,
            assetTag: asset.asset_tag,
            reason: `Asset is "${asset.status}"${asset.current_employee_name ? ` (held by ${asset.current_employee_name})` : ''}`,
          });
        }
      }
    }

    const byLine = new Map();
    if (lineIds.length) {
      const lineRes = await t.query(
        'SELECT * FROM mobile_lines WHERE id = ANY($1::uuid[]) FOR UPDATE',
        [lineIds]
      );
      lineRes.rows.forEach((l) => byLine.set(l.id, l));
      for (const item of lineItems) {
        const line = byLine.get(item.lineId);
        if (!line) {
          conflicts.push({ lineId: item.lineId, reason: 'Mobile line no longer exists' });
        } else if (line.current_employee_id) {
          conflicts.push({
            lineId: line.id,
            phoneNumber: line.phone_number,
            reason: `Line is already assigned to ${line.current_employee_name}`,
          });
        } else if (
          line.reserved_for_employee_id
          && line.reserved_for_employee_id !== employee.id
        ) {
          conflicts.push({
            lineId: line.id,
            phoneNumber: line.phone_number,
            reason: 'Line is reserved for another employee onboarding',
          });
        } else if (
          line.reserved_for_employee_id
          && line.reserved_for_employee_id === employee.id
          && !allowReservedForEmployeeId
        ) {
          conflicts.push({
            lineId: line.id,
            phoneNumber: line.phone_number,
            reason: 'Line is reserved for onboarding — complete onboarding or release the reservation first',
          });
        } else if (line.status !== 'Active') {
          conflicts.push({
            lineId: line.id,
            phoneNumber: line.phone_number,
            reason: `Line status is "${line.status}" (only Active lines can be assigned)`,
          });
        }
      }
    }

    if (conflicts.length > 0) {
      throw HttpError.conflict('Handover rejected: one or more basket items are unavailable', conflicts);
    }

    const receiptAssets = assetItems.map((item) => {
      const a = byAsset.get(item.assetId);
      return {
        kind: 'asset',
        assetId: a.id,
        assetTag: a.asset_tag,
        brand: a.brand,
        model: a.model,
        category: a.category,
        serialNumber: a.serial_number,
        macAddress: a.mac_ethernet || a.mac_wifi || null,
        conditionNote: item.conditionNote || '',
      };
    });

    const receiptLines = lineItems.map((item) => {
      const l = byLine.get(item.lineId);
      return {
        kind: 'line',
        lineId: l.id,
        phoneNumber: l.phone_number,
        operator: l.operator || null,
        plan: l.plan || null,
        simSerial: l.sim_serial || null,
        conditionNote: item.conditionNote || '',
        // Asset-shaped aliases so older receipt renderers still show something.
        category: 'Mobile Line',
        brand: l.operator || 'Mobile',
        model: l.phone_number,
        serialNumber: l.sim_serial || l.phone_number,
        macAddress: null,
        assetTag: l.phone_number,
      };
    });

    const receiptItems = [...receiptAssets, ...receiptLines];

    if (assetIds.length) {
      await t.query(
        `UPDATE assets SET status = 'Assigned', current_employee_id = $1,
                current_employee_name = $2, updated_at = now()
         WHERE id = ANY($3::uuid[])`,
        [employee.id, employee.full_name, assetIds]
      );

      for (const item of receiptAssets) {
        await t.query(
          `INSERT INTO asset_history
             (asset_id, asset_tag, employee_id, employee_name, action_type, notes, changed_by, changed_by_name)
           VALUES ($1, $2, $3, $4, 'assigned', $5, $6, $7)`,
          [item.assetId, item.assetTag, employee.id, employee.full_name,
           item.conditionNote, itUser.uid, itUser.username || itUser.email]
        );
      }

      await t.query(
        'UPDATE employees SET active_asset_count = active_asset_count + $2 WHERE id = $1',
        [employee.id, receiptAssets.length]
      );
    }

    if (lineIds.length) {
      await t.query(
        `UPDATE mobile_lines SET current_employee_id = $2, current_employee_name = $3,
                reserved_for_employee_id = NULL, updated_at = now()
         WHERE id = ANY($1::uuid[])`,
        [lineIds, employee.id, employee.full_name]
      );
      const by = itUser.uid || null;
      const byName = itUser.username || itUser.email || 'IT';
      for (const item of receiptLines) {
        await t.query(
          `INSERT INTO mobile_line_history
             (line_id, phone_number, employee_id, employee_name, action_type, notes, changed_by, changed_by_name)
           VALUES ($1,$2,$3,$4,'line_assigned',$5,$6,$7)`,
          [item.lineId, item.phoneNumber, employee.id, employee.full_name,
           [item.operator, item.plan].filter(Boolean).join(' · ') || item.conditionNote || '',
           by, byName]
        );
      }
    }

    const handoverRes = await t.query(
      `INSERT INTO handovers (employee_id, employee_name, it_user_id, it_user_name, document_type, items, template_id)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7) RETURNING id`,
      [employee.id, employee.full_name, itUser.uid, itUser.username || itUser.email || null,
       documentType, JSON.stringify(receiptItems),
       templateId ? String(templateId).slice(0, 64) : null]
    );

    return {
      handoverId: handoverRes.rows[0].id,
      employee: { id: employee.id, fullName: employee.full_name },
      documentType,
      templateId: templateId || null,
      itemCount: receiptItems.length,
      assetCount: receiptAssets.length,
      lineCount: receiptLines.length,
      items: receiptItems,
    };
  });
}

async function getHandover(handoverId) {
  if (!isUuid(handoverId)) throw HttpError.notFound(`Handover ${handoverId} not found`);
  // Join the assigner's account so reprints can show the ORIGINAL name — and
  // only fall back to the current user when that account is disabled/deleted.
  const { rows } = await query(
    `SELECT h.*, (u.id IS NOT NULL AND u.status = 'Active') AS it_user_active
     FROM handovers h
     LEFT JOIN users u ON u.id::text = h.it_user_id
     WHERE h.id = $1`,
    [handoverId]
  );
  if (!rows[0]) throw HttpError.notFound(`Handover ${handoverId} not found`);
  return mapRow(rows[0]);
}

async function listHandovers({ employeeId, limit = 50 } = {}) {
  const params = [];
  let where = '';
  if (employeeId) {
    if (!isUuid(employeeId)) return [];
    params.push(employeeId);
    where = 'WHERE employee_id = $1';
  }
  params.push(Math.min(Number(limit) || 50, 200));
  const { rows } = await query(
    `SELECT * FROM handovers ${where} ORDER BY transaction_date DESC LIMIT $${params.length}`,
    params
  );
  return mapRows(rows);
}

module.exports = { executeHandover, getHandover, listHandovers };
