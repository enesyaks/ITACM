/**
 * Employee offboarding — checklist + transactional disposition of
 * personal hardware, software seats, mobile lines, and infra responsibility.
 */
const { query, withTransaction } = require('./pool');
const { mapRow, mapRows, isUuid } = require('./rowMapper');
const { HttpError } = require('../../utils/httpError');
const { normalizeSale, formatSaleSummary, appendSaleToNotes } = require('../../utils/saleNote');
const auditService = require('./auditService');
const authProvider = require('./authProvider');

const HW_ACTIONS = new Set(['return', 'reassign', 'scrap', 'sell']);
const LINE_ACTIONS = new Set(['unassign', 'reassign']);
const LIC_ACTIONS = new Set(['revoke', 'reassign']);
const INFRA_ACTIONS = new Set(['clear', 'reassign']);
const CONTRACT_ACTIONS = new Set(['clear', 'reassign']);
const INFRA_CATS = new Set(['Network', 'Server']);

function actor(itUser) {
  return {
    id: (itUser && (itUser.uid || itUser.id)) || 'system',
    name: (itUser && (itUser.username || itUser.email)) || 'system',
  };
}

async function loadActiveEmployee(t, employeeId, { forReceive = false } = {}) {
  if (!isUuid(employeeId)) throw HttpError.badRequest('Invalid employee id');
  const { rows } = await t.query('SELECT * FROM employees WHERE id = $1 FOR UPDATE', [employeeId]);
  const emp = rows[0];
  if (!emp) throw HttpError.notFound(`Employee ${employeeId} not found`);
  if (forReceive && emp.status !== 'Active') {
    throw HttpError.conflict(`${emp.full_name} is inactive and cannot receive items`);
  }
  return emp;
}

async function getOffboardingChecklist(employeeId) {
  if (!isUuid(employeeId)) throw HttpError.notFound(`Employee ${employeeId} not found`);
  const { rows: empRows } = await query('SELECT * FROM employees WHERE id = $1', [employeeId]);
  if (!empRows[0]) throw HttpError.notFound(`Employee ${employeeId} not found`);
  const emp = mapRow(empRows[0]);

  const [assets, licenses, lines, infra, contracts] = await Promise.all([
    query(
      `SELECT id, asset_tag, brand, model, category, serial_number, status, location
       FROM assets
       WHERE current_employee_id = $1 AND status = 'Assigned'
         AND category NOT IN ('Network', 'Server')
       ORDER BY asset_tag`,
      [employeeId]
    ),
    query(
      `SELECT id, license_id, software_name, assigned_at
       FROM license_assignments
       WHERE employee_id = $1 AND revoked_at IS NULL
       ORDER BY software_name`,
      [employeeId]
    ),
    query(
      `SELECT id, phone_number, operator, plan, status
       FROM mobile_lines WHERE current_employee_id = $1
       ORDER BY phone_number`,
      [employeeId]
    ).catch(() => ({ rows: [] })),
    query(
      `SELECT id, asset_tag, brand, model, category, location, status, infra_role
       FROM assets
       WHERE responsible_employee_id = $1 AND category IN ('Network', 'Server')
       ORDER BY asset_tag`,
      [employeeId]
    ),
    query(
      `SELECT c.id, c.title, c.status, c.contract_number, c.end_date,
              p.name AS provider_name
       FROM contracts c
       JOIN providers p ON p.id = c.provider_id
       WHERE c.owner_employee_id = $1
       ORDER BY c.title`,
      [employeeId]
    ),
  ]);

  return {
    employee: emp,
    assets: mapRows(assets.rows),
    licenses: mapRows(licenses.rows),
    lines: mapRows(lines.rows),
    infra: mapRows(infra.rows),
    contracts: mapRows(contracts.rows),
    counts: {
      assets: assets.rows.length,
      licenses: licenses.rows.length,
      lines: lines.rows.length,
      infra: infra.rows.length,
      contracts: contracts.rows.length,
      total: assets.rows.length + licenses.rows.length + lines.rows.length +
        infra.rows.length + contracts.rows.length,
    },
  };
}

async function insertAssetHistory(t, {
  assetId, assetTag, actionType, notes = '',
  employeeId = null, employeeName = null, itUser,
}) {
  const a = actor(itUser);
  await t.query(
    `INSERT INTO asset_history
       (asset_id, asset_tag, employee_id, employee_name, action_type, notes, changed_by, changed_by_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [assetId, assetTag, employeeId, employeeName, actionType, notes || '', a.id, a.name]
  );
}

async function disposeHardware(t, asset, action, fromEmp, toEmp, note, itUser, saleRaw) {
  const tag = asset.asset_tag;
  const fromId = fromEmp.id;
  const fromName = fromEmp.full_name;
  const noteBit = note ? ` · ${note}` : '';

  if (action === 'return') {
    await t.query(
      `UPDATE assets SET status = 'In Stock', current_employee_id = NULL,
         current_employee_name = NULL, updated_at = now() WHERE id = $1`,
      [asset.id]
    );
    await t.query(
      'UPDATE employees SET active_asset_count = GREATEST(active_asset_count - 1, 0) WHERE id = $1',
      [fromId]
    );
    await insertAssetHistory(t, {
      assetId: asset.id, assetTag: tag, actionType: 'returned',
      notes: `Offboard return${noteBit}`,
      employeeId: fromId, employeeName: fromName, itUser,
    });
    return { assetId: asset.id, assetTag: tag, action: 'return' };
  }

  if (action === 'reassign') {
    if (!toEmp) throw HttpError.badRequest(`Reassign target required for ${tag}`);
    await t.query(
      `UPDATE assets SET status = 'Assigned', current_employee_id = $2,
         current_employee_name = $3, updated_at = now() WHERE id = $1`,
      [asset.id, toEmp.id, toEmp.full_name]
    );
    await t.query(
      'UPDATE employees SET active_asset_count = GREATEST(active_asset_count - 1, 0) WHERE id = $1',
      [fromId]
    );
    await t.query(
      'UPDATE employees SET active_asset_count = active_asset_count + 1 WHERE id = $1',
      [toEmp.id]
    );
    await insertAssetHistory(t, {
      assetId: asset.id, assetTag: tag, actionType: 'returned',
      notes: `Offboard transfer to ${toEmp.full_name}${noteBit}`,
      employeeId: fromId, employeeName: fromName, itUser,
    });
    await insertAssetHistory(t, {
      assetId: asset.id, assetTag: tag, actionType: 'assigned',
      notes: `Offboard transfer from ${fromName}${noteBit}`,
      employeeId: toEmp.id, employeeName: toEmp.full_name, itUser,
    });
    return { assetId: asset.id, assetTag: tag, action: 'reassign', toEmployeeId: toEmp.id };
  }

  if (action === 'scrap' || action === 'sell') {
    const status = action === 'sell' ? 'Sold' : 'Scrap';
    const histType = action === 'sell' ? 'sold' : 'status_changed';
    const sale = action === 'sell' ? normalizeSale(saleRaw, { required: true }) : null;
    const saleSummary = sale ? formatSaleSummary(sale) : '';
    const newNotes = sale ? appendSaleToNotes(asset.notes, sale) : null;

    if (sale) {
      await t.query(
        `UPDATE assets SET status = $2, current_employee_id = NULL,
           current_employee_name = NULL, notes = $3, updated_at = now() WHERE id = $1`,
        [asset.id, status, newNotes]
      );
    } else {
      await t.query(
        `UPDATE assets SET status = $2, current_employee_id = NULL,
           current_employee_name = NULL, updated_at = now() WHERE id = $1`,
        [asset.id, status]
      );
    }
    await t.query(
      'UPDATE employees SET active_asset_count = GREATEST(active_asset_count - 1, 0) WHERE id = $1',
      [fromId]
    );
    const sellBits = [
      action === 'sell' ? 'Offboard sold' : `Offboard scrap · Assigned → Scrap`,
      saleSummary,
      note || '',
    ].filter(Boolean).join(' · ');
    await insertAssetHistory(t, {
      assetId: asset.id, assetTag: tag, actionType: histType,
      notes: sellBits,
      employeeId: fromId, employeeName: fromName, itUser,
    });
    return { assetId: asset.id, assetTag: tag, action, sale: sale || undefined };
  }

  throw HttpError.badRequest(`Unknown hardware action: ${action}`);
}

async function disposeLine(t, line, action, fromEmp, toEmp, itUser) {
  const a = actor(itUser);
  if (action === 'unassign') {
    await t.query(
      `UPDATE mobile_lines SET current_employee_id = NULL, current_employee_name = NULL, updated_at = now()
       WHERE id = $1`,
      [line.id]
    );
    await t.query(
      `INSERT INTO mobile_line_history
         (line_id, phone_number, employee_id, employee_name, action_type, notes, changed_by, changed_by_name)
       VALUES ($1,$2,$3,$4,'line_unassigned',$5,$6,$7)`,
      [line.id, line.phone_number, fromEmp.id, fromEmp.full_name, 'Offboard unassign', a.id, a.name]
    );
    return { lineId: line.id, phoneNumber: line.phone_number, action: 'unassign' };
  }
  if (action === 'reassign') {
    if (!toEmp) throw HttpError.badRequest(`Reassign target required for line ${line.phone_number}`);
    await t.query(
      `UPDATE mobile_lines SET current_employee_id = $2, current_employee_name = $3, updated_at = now()
       WHERE id = $1`,
      [line.id, toEmp.id, toEmp.full_name]
    );
    await t.query(
      `INSERT INTO mobile_line_history
         (line_id, phone_number, employee_id, employee_name, action_type, notes, changed_by, changed_by_name)
       VALUES ($1,$2,$3,$4,'line_unassigned',$5,$6,$7)`,
      [line.id, line.phone_number, fromEmp.id, fromEmp.full_name, `Offboard → ${toEmp.full_name}`, a.id, a.name]
    );
    await t.query(
      `INSERT INTO mobile_line_history
         (line_id, phone_number, employee_id, employee_name, action_type, notes, changed_by, changed_by_name)
       VALUES ($1,$2,$3,$4,'line_assigned',$5,$6,$7)`,
      [line.id, line.phone_number, toEmp.id, toEmp.full_name, `Offboard from ${fromEmp.full_name}`, a.id, a.name]
    );
    return { lineId: line.id, phoneNumber: line.phone_number, action: 'reassign', toEmployeeId: toEmp.id };
  }
  throw HttpError.badRequest(`Unknown line action: ${action}`);
}

async function disposeLicense(t, assignment, action, fromEmp, toEmp, itUser) {
  const a = actor(itUser);
  if (action === 'revoke') {
    await t.query(
      'UPDATE license_assignments SET revoked_at = now(), revoked_by = $2 WHERE id = $1',
      [assignment.id, a.id]
    );
    await t.query(
      'UPDATE licenses SET used_seats = GREATEST(used_seats - 1, 0) WHERE id = $1',
      [assignment.license_id]
    );
    return { assignmentId: assignment.id, softwareName: assignment.software_name, action: 'revoke' };
  }
  if (action === 'reassign') {
    if (!toEmp) throw HttpError.badRequest(`Reassign target required for ${assignment.software_name}`);
    const dupe = await t.query(
      `SELECT 1 FROM license_assignments
       WHERE license_id = $1 AND employee_id = $2 AND revoked_at IS NULL`,
      [assignment.license_id, toEmp.id]
    );
    if (dupe.rows.length) {
      throw HttpError.conflict(`${assignment.software_name} is already assigned to ${toEmp.full_name}`);
    }
    await t.query(
      'UPDATE license_assignments SET revoked_at = now(), revoked_by = $2 WHERE id = $1',
      [assignment.id, a.id]
    );
    await t.query(
      `INSERT INTO license_assignments
         (license_id, software_name, employee_id, employee_name, assigned_by, assigned_by_name)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [assignment.license_id, assignment.software_name, toEmp.id, toEmp.full_name, a.id, a.name]
    );
    return {
      assignmentId: assignment.id,
      softwareName: assignment.software_name,
      action: 'reassign',
      toEmployeeId: toEmp.id,
    };
  }
  throw HttpError.badRequest(`Unknown license action: ${action}`);
}

async function disposeInfra(t, asset, action, fromEmp, toEmp, itUser) {
  if (action === 'clear') {
    await t.query(
      `UPDATE assets SET responsible_employee_id = NULL, responsible_employee_name = NULL, updated_at = now()
       WHERE id = $1`,
      [asset.id]
    );
    await insertAssetHistory(t, {
      assetId: asset.id, assetTag: asset.asset_tag, actionType: 'responsible_changed',
      notes: `Offboard cleared responsible (was ${fromEmp.full_name})`,
      employeeId: fromEmp.id, employeeName: fromEmp.full_name, itUser,
    });
    return { assetId: asset.id, assetTag: asset.asset_tag, action: 'clear' };
  }
  if (action === 'reassign') {
    if (!toEmp) throw HttpError.badRequest(`Reassign target required for ${asset.asset_tag}`);
    if (!asset.location) {
      throw HttpError.badRequest(
        `${asset.asset_tag} has no location — set a location before transferring responsibility`
      );
    }
    await t.query(
      `UPDATE assets SET responsible_employee_id = $2, responsible_employee_name = $3, updated_at = now()
       WHERE id = $1`,
      [asset.id, toEmp.id, toEmp.full_name]
    );
    await insertAssetHistory(t, {
      assetId: asset.id, assetTag: asset.asset_tag, actionType: 'responsible_changed',
      notes: `Offboard responsible: ${fromEmp.full_name} → ${toEmp.full_name}`,
      employeeId: toEmp.id, employeeName: toEmp.full_name, itUser,
    });
    await insertAssetHistory(t, {
      assetId: asset.id, assetTag: asset.asset_tag, actionType: 'responsible_changed',
      notes: `Removed as responsible (offboard → ${toEmp.full_name})`,
      employeeId: fromEmp.id, employeeName: fromEmp.full_name, itUser,
    });
    return { assetId: asset.id, assetTag: asset.asset_tag, action: 'reassign', toEmployeeId: toEmp.id };
  }
  throw HttpError.badRequest(`Unknown infra action: ${action}`);
}


async function disposeContract(t, contract, action, fromEmp, toEmp) {
  if (action === 'clear') {
    await t.query(
      `UPDATE contracts SET owner_employee_id = NULL, owner_employee_name = NULL, updated_at = now()
       WHERE id = $1`,
      [contract.id]
    );
    return { contractId: contract.id, title: contract.title, action: 'clear' };
  }
  if (action === 'reassign') {
    if (!toEmp) throw HttpError.badRequest(`Reassign target required for contract ${contract.title}`);
    await t.query(
      `UPDATE contracts SET owner_employee_id = $2, owner_employee_name = $3, updated_at = now()
       WHERE id = $1`,
      [contract.id, toEmp.id, toEmp.full_name]
    );
    return {
      contractId: contract.id,
      title: contract.title,
      action: 'reassign',
      toEmployeeId: toEmp.id,
    };
  }
  throw HttpError.badRequest(`Unknown contract action: ${action}`);
}

async function executeOffboard(employeeId, body, itUser) {
  if (!isUuid(employeeId)) throw HttpError.notFound(`Employee ${employeeId} not found`);
  const {
    assets = [], lines = [], licenses = [], infra = [], contracts = [], deactivate = true,
  } = body || {};

  // Offboarding runs as one atomic transaction, so a disposal that needs
  // sign-off cannot be deferred half-way through it. Refuse up front instead of
  // silently selling/scrapping around the approval policy.
  const disposals = assets.filter((i) => i && (i.action === 'sell' || i.action === 'scrap'));
  if (disposals.length) {
    const config = await require('./approvalService').getConfig().catch(() => ({ enabled: false }));
    if (config.enabled) {
      const needsApproval = disposals.filter((i) => {
        const levels = config.policy[i.action === 'sell' ? 'asset_sale' : 'asset_scrap'];
        return Array.isArray(levels) && levels.length;
      });
      if (needsApproval.length) {
        throw HttpError.conflict(
          `${needsApproval.length} item(s) are marked sell/scrap, which your approval policy requires `
          + 'sign-off for. Return them to stock here, then sell or scrap them from the Hardware screen '
          + 'so the request goes through approval.'
        );
      }
    }
  }

  const result = await withTransaction(async (t) => {
    const fromEmp = await loadActiveEmployee(t, employeeId);
    if (fromEmp.status === 'Inactive') {
      throw HttpError.conflict(`${fromEmp.full_name} is already inactive`);
    }

    const toCache = new Map();
    async function resolveTo(id) {
      if (!id) return null;
      if (toCache.has(id)) return toCache.get(id);
      if (id === employeeId) {
        throw HttpError.badRequest('Cannot reassign items to the same employee being offboarded');
      }
      const emp = await loadActiveEmployee(t, id, { forReceive: true });
      toCache.set(id, emp);
      return emp;
    }

    const summary = { assets: [], lines: [], licenses: [], infra: [], contracts: [], deactivated: false };

    for (const item of assets) {
      const action = String(item.action || '');
      if (!HW_ACTIONS.has(action)) throw HttpError.badRequest(`Invalid asset action: ${action}`);
      if (!isUuid(item.assetId)) throw HttpError.badRequest('Invalid assetId');
      const { rows } = await t.query('SELECT * FROM assets WHERE id = $1 FOR UPDATE', [item.assetId]);
      const asset = rows[0];
      if (!asset) throw HttpError.notFound(`Asset ${item.assetId} not found`);
      if (asset.current_employee_id !== employeeId || asset.status !== 'Assigned') {
        throw HttpError.conflict(`${asset.asset_tag} is not currently assigned to this employee`);
      }
      if (INFRA_CATS.has(asset.category)) {
        throw HttpError.badRequest(`${asset.asset_tag} is Network/Server — use infra dispositions`);
      }
      const toEmp = action === 'reassign' ? await resolveTo(item.toEmployeeId) : null;
      summary.assets.push(
        await disposeHardware(t, asset, action, fromEmp, toEmp, item.note, itUser, item.sale)
      );
    }

    for (const item of lines) {
      const action = String(item.action || '');
      if (!LINE_ACTIONS.has(action)) throw HttpError.badRequest(`Invalid line action: ${action}`);
      if (!isUuid(item.lineId)) throw HttpError.badRequest('Invalid lineId');
      const { rows } = await t.query('SELECT * FROM mobile_lines WHERE id = $1 FOR UPDATE', [item.lineId]);
      const line = rows[0];
      if (!line) throw HttpError.notFound(`Line ${item.lineId} not found`);
      if (line.current_employee_id !== employeeId) {
        throw HttpError.conflict(`Line ${line.phone_number} is not assigned to this employee`);
      }
      const toEmp = action === 'reassign' ? await resolveTo(item.toEmployeeId) : null;
      summary.lines.push(await disposeLine(t, line, action, fromEmp, toEmp, itUser));
    }

    for (const item of licenses) {
      const action = String(item.action || '');
      if (!LIC_ACTIONS.has(action)) throw HttpError.badRequest(`Invalid license action: ${action}`);
      if (!isUuid(item.assignmentId)) throw HttpError.badRequest('Invalid assignmentId');
      const { rows } = await t.query(
        'SELECT * FROM license_assignments WHERE id = $1 FOR UPDATE',
        [item.assignmentId]
      );
      const asg = rows[0];
      if (!asg) throw HttpError.notFound(`License assignment ${item.assignmentId} not found`);
      if (asg.employee_id !== employeeId || asg.revoked_at) {
        throw HttpError.conflict(`${asg.software_name} is not an active seat for this employee`);
      }
      await t.query('SELECT id FROM licenses WHERE id = $1 FOR UPDATE', [asg.license_id]);
      const toEmp = action === 'reassign' ? await resolveTo(item.toEmployeeId) : null;
      summary.licenses.push(await disposeLicense(t, asg, action, fromEmp, toEmp, itUser));
    }

    for (const item of infra) {
      const action = String(item.action || '');
      if (!INFRA_ACTIONS.has(action)) throw HttpError.badRequest(`Invalid infra action: ${action}`);
      if (!isUuid(item.assetId)) throw HttpError.badRequest('Invalid assetId');
      const { rows } = await t.query('SELECT * FROM assets WHERE id = $1 FOR UPDATE', [item.assetId]);
      const asset = rows[0];
      if (!asset) throw HttpError.notFound(`Asset ${item.assetId} not found`);
      if (asset.responsible_employee_id !== employeeId || !INFRA_CATS.has(asset.category)) {
        throw HttpError.conflict(`${asset.asset_tag} is not under this employee's infra responsibility`);
      }
      const toEmp = action === 'reassign' ? await resolveTo(item.toEmployeeId) : null;
      summary.infra.push(await disposeInfra(t, asset, action, fromEmp, toEmp, itUser));
    }

    for (const item of contracts) {
      const action = String(item.action || '');
      if (!CONTRACT_ACTIONS.has(action)) throw HttpError.badRequest(`Invalid contract action: ${action}`);
      if (!isUuid(item.contractId)) throw HttpError.badRequest('Invalid contractId');
      const { rows } = await t.query('SELECT * FROM contracts WHERE id = $1 FOR UPDATE', [item.contractId]);
      const contract = rows[0];
      if (!contract) throw HttpError.notFound(`Contract ${item.contractId} not found`);
      if (contract.owner_employee_id !== employeeId) {
        throw HttpError.conflict(`${contract.title} is not owned by this employee`);
      }
      const toEmp = action === 'reassign' ? await resolveTo(item.toEmployeeId) : null;
      summary.contracts.push(await disposeContract(t, contract, action, fromEmp, toEmp));
    }

    const leftAssets = await t.query(
      `SELECT COUNT(*)::int AS n FROM assets
       WHERE current_employee_id = $1 AND status = 'Assigned'`,
      [employeeId]
    );
    const leftLines = await t.query(
      'SELECT COUNT(*)::int AS n FROM mobile_lines WHERE current_employee_id = $1',
      [employeeId]
    ).catch(() => ({ rows: [{ n: 0 }] }));
    const leftLic = await t.query(
      `SELECT COUNT(*)::int AS n FROM license_assignments
       WHERE employee_id = $1 AND revoked_at IS NULL`,
      [employeeId]
    );
    const leftInfra = await t.query(
      `SELECT COUNT(*)::int AS n FROM assets
       WHERE responsible_employee_id = $1 AND category IN ('Network', 'Server')`,
      [employeeId]
    );
    const leftContracts = await t.query(
      "SELECT COUNT(*)::int AS n FROM contracts WHERE owner_employee_id = $1",
      [employeeId]
    );

    const remaining = {
      assets: leftAssets.rows[0].n,
      lines: leftLines.rows[0].n,
      licenses: leftLic.rows[0].n,
      infra: leftInfra.rows[0].n,
      contracts: leftContracts.rows[0].n,
    };

    if (deactivate) {
      if (remaining.assets || remaining.lines || remaining.licenses || remaining.infra || remaining.contracts) {
        throw HttpError.conflict(
          `Cannot deactivate: remaining holdings — ` +
          `${remaining.assets} asset(s), ${remaining.licenses} license(s), ` +
          `${remaining.lines} line(s), ${remaining.infra} infra device(s), ${remaining.contracts} contract(s). ` +
          'Include a disposition for every item.'
        );
      }
      await t.query(
        `UPDATE employees SET status = 'Inactive' WHERE id = $1`,
        [employeeId]
      );
      summary.deactivated = true;
    }

    summary.remaining = remaining;
    summary.employeeId = employeeId;
    summary.employeeName = fromEmp.full_name;
    summary.employeeEmail = fromEmp.email;
    return summary;
  });

  try {
    await auditService.logEvent({
      action: 'employee.offboard',
      source: 'employees',
      summary: `Offboarded ${result.employeeName}` +
        (result.deactivated ? ' → Inactive' : ''),
      actorId: actor(itUser).id,
      actorEmail: itUser && itUser.email,
      actorName: actor(itUser).name,
      entityType: 'employee',
      entityId: employeeId,
      entityLabel: result.employeeName,
      meta: {
        assets: result.assets.length,
        licenses: result.licenses.length,
        lines: result.lines.length,
        infra: result.infra.length,
        contracts: result.contracts.length,
        deactivated: result.deactivated,
        detail: result,
      },
    });
  } catch { /* ignore */ }

  // Offboard → Inactive closes Portal login (sessions + user row).
  if (result.deactivated) {
    await authProvider.revokePortalAccess(
      { employee: { email: result.employeeEmail, fullName: result.employeeName } },
      itUser,
      { soft: true }
    ).catch(() => {});
  }

  return result;
}

/**
 * Perform a sale/scrap that an approver has just signed off.
 *
 * approvalService.dispatch() has always routed 'asset_sale' / 'asset_scrap'
 * here; until now the function did not exist, so dispatch silently returned
 * null and an approved request changed nothing. This is that missing half.
 *
 * @param {'asset_sale'|'asset_scrap'} type
 * @param {{assetId:string, sale?:object, note?:string, itUser?:object}} payload
 * @param {{name?:string, viaApproval?:string}} actor
 */
async function replayApproved(type, payload = {}, actor = {}) {
  const action = type === 'asset_sale' ? 'sell' : type === 'asset_scrap' ? 'scrap' : null;
  if (!action) throw HttpError.badRequest(`Unsupported approval type: ${type}`);
  const assetId = payload.assetId;
  if (!isUuid(assetId)) throw HttpError.badRequest('Approved payload has no valid assetId');

  const itUser = payload.itUser || {};
  const via = actor.viaApproval ? ` · approval ${actor.viaApproval}` : '';
  const note = [payload.note, actor.name ? `Approved by ${actor.name}` : ''].filter(Boolean).join(' · ') + via;

  return withTransaction(async (t) => {
    const { rows } = await t.query('SELECT * FROM assets WHERE id = $1 FOR UPDATE', [assetId]);
    const asset = rows[0];
    if (!asset) throw HttpError.notFound(`Asset ${assetId} not found`);
    if (asset.status === 'Sold' || asset.status === 'Scrap') {
      // Already disposed — no-op so a replayed/double approval cannot
      // decrement the holder's counter twice.
      return { assetId, assetTag: asset.asset_tag, action, alreadyApplied: true };
    }

    const holder = asset.current_employee_id
      ? { id: asset.current_employee_id, full_name: asset.current_employee_name }
      : { id: null, full_name: null };

    const status = action === 'sell' ? 'Sold' : 'Scrap';
    const sale = action === 'sell' ? normalizeSale(payload.sale, { required: true }) : null;
    const saleSummary = sale ? formatSaleSummary(sale) : '';
    const newNotes = sale ? appendSaleToNotes(asset.notes, sale) : null;

    if (sale) {
      await t.query(
        `UPDATE assets SET status = $2, current_employee_id = NULL,
           current_employee_name = NULL, notes = $3, updated_at = now() WHERE id = $1`,
        [asset.id, status, newNotes]
      );
    } else {
      await t.query(
        `UPDATE assets SET status = $2, current_employee_id = NULL,
           current_employee_name = NULL, updated_at = now() WHERE id = $1`,
        [asset.id, status]
      );
    }
    if (holder.id) {
      await t.query(
        'UPDATE employees SET active_asset_count = GREATEST(active_asset_count - 1, 0) WHERE id = $1',
        [holder.id]
      );
    }
    await insertAssetHistory(t, {
      assetId: asset.id,
      assetTag: asset.asset_tag,
      actionType: action === 'sell' ? 'sold' : 'status_changed',
      notes: [action === 'sell' ? 'Approved sale' : 'Approved scrap', saleSummary, note]
        .filter(Boolean).join(' · '),
      employeeId: holder.id,
      employeeName: holder.full_name,
      itUser,
    });

    auditService.logEvent({
      action: action === 'sell' ? 'asset.sold' : 'asset.scrapped',
      source: 'approvals',
      summary: `${asset.asset_tag} ${action === 'sell' ? 'sold' : 'scrapped'} after approval`,
      actorId: itUser.uid || null,
      actorEmail: itUser.email || null,
      actorName: actor.name || itUser.username || 'Approval',
      entityType: 'asset',
      entityId: asset.id,
      entityLabel: asset.asset_tag,
      meta: { action, sale: sale || undefined, viaApproval: actor.viaApproval || null },
    }).catch(() => {});

    return { assetId: asset.id, assetTag: asset.asset_tag, action, sale: sale || undefined };
  });
}

module.exports = { getOffboardingChecklist, executeOffboard, replayApproved };
