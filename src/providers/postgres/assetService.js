/** Asset service (postgres) — Hardware Inventory backend. */
const { query, withTransaction } = require('./pool');
const { mapAsset, mapRows, isUuid } = require('./rowMapper');
const { HttpError } = require('../../utils/httpError');
const { normalizeSale, formatSaleSummary, appendSaleToNotes } = require('../../utils/saleNote');

const STATUSES = ['In Stock', 'Assigned', 'In Repair', 'Scrap', 'Sold', 'Reserved'];
const INFRA_CATEGORIES = new Set(['Network', 'Server']);
const INFRA_ROLES = new Set([
  'Switch', 'Firewall', 'Access Point', 'Router', 'Load Balancer',
  'Hypervisor', 'Physical Server', 'Storage', 'Appliance', 'Other',
]);
const MAX_ASSET_LICENSES = 20;

const buildQrCodeString = (assetTag) => `ITACPRO|ASSET|${assetTag}`;

async function resolveResponsibleEmployee(employeeId) {
  if (employeeId === null || employeeId === '') {
    return { responsible_employee_id: null, responsible_employee_name: null };
  }
  if (!isUuid(employeeId)) throw HttpError.badRequest('responsibleEmployeeId must be a valid UUID');
  const { rows } = await query('SELECT id, full_name FROM employees WHERE id = $1', [employeeId]);
  if (!rows[0]) throw HttpError.badRequest('Responsible employee not found');
  return {
    responsible_employee_id: rows[0].id,
    responsible_employee_name: rows[0].full_name,
  };
}

async function resolveParentAsset(parentId, selfId) {
  if (parentId === null || parentId === '') return { parent_asset_id: null };
  if (!isUuid(parentId)) throw HttpError.badRequest('parentAssetId must be a valid UUID');
  if (selfId && parentId === selfId) {
    throw HttpError.badRequest('A device cannot be its own parent');
  }
  const { rows } = await query(
    'SELECT id, category, parent_asset_id FROM assets WHERE id = $1',
    [parentId]
  );
  if (!rows[0]) throw HttpError.badRequest('Parent device not found');
  if (!INFRA_CATEGORIES.has(rows[0].category)) {
    throw HttpError.badRequest('Parent device must be Network or Server equipment');
  }
  if (selfId && rows[0].parent_asset_id === selfId) {
    throw HttpError.badRequest('Circular parent relationship is not allowed');
  }
  return { parent_asset_id: rows[0].id };
}

function assertInfraPlacement({ category, location, responsible_employee_id }) {
  if (!INFRA_CATEGORIES.has(category)) return;
  if (!location) {
    throw HttpError.badRequest('Location is required for Network/Server equipment');
  }
  if (!responsible_employee_id) {
    throw HttpError.badRequest('A responsible person is required for Network/Server equipment');
  }
}

function clearInfraFields(data) {
  data.infra_role = null;
  data.rack = null;
  data.rack_unit = null;
  data.rack_u_start = null;
  data.rack_u_size = null;
  data.firmware_version = null;
  data.firmware_updated_at = null;
  data.mgmt_ip = null;
  data.parent_asset_id = null;
}

function actorFrom(itUser) {
  if (!itUser) return { id: 'system', name: 'system' };
  return {
    id: itUser.uid || itUser.id || 'system',
    name: itUser.username || itUser.email || itUser.uid || 'system',
  };
}

async function insertAssetHistory(client, {
  assetId, assetTag, actionType, notes = '',
  employeeId = null, employeeName = null, itUser = null,
}) {
  const actor = actorFrom(itUser);
  await client.query(
    `INSERT INTO asset_history
       (asset_id, asset_tag, employee_id, employee_name, action_type, notes, changed_by, changed_by_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      assetId,
      assetTag,
      employeeId || null,
      employeeName || null,
      actionType,
      notes || '',
      actor.id,
      actor.name,
    ]
  );
}

function describeFieldDiffs(before, after, fields) {
  const parts = [];
  for (const { key, label, fmt } of fields) {
    const a = before[key];
    const b = after[key];
    const sa = a == null || a === '' ? '—' : (fmt ? fmt(a) : String(a));
    const sb = b == null || b === '' ? '—' : (fmt ? fmt(b) : String(b));
    if (sa !== sb) parts.push(`${label}: ${sa} → ${sb}`);
  }
  return parts;
}

function normalizeLicenseIds(raw) {
  let list = raw;
  if (list == null || list === '') return [];
  if (!Array.isArray(list)) list = [list];
  const ids = [...new Set(list.map((x) => String(x || '').trim()).filter(Boolean))];
  if (ids.length > MAX_ASSET_LICENSES) {
    throw HttpError.badRequest(`At most ${MAX_ASSET_LICENSES} licenses can be linked to one device`);
  }
  for (const id of ids) {
    if (!isUuid(id)) throw HttpError.badRequest(`Invalid license id: ${id}`);
  }
  return ids;
}

async function assertLicensesExist(client, ids) {
  if (!ids.length) return;
  const q = client && client.query ? client : { query };
  const { rows } = await q.query(
    'SELECT id FROM licenses WHERE id = ANY($1::uuid[])',
    [ids]
  );
  if (rows.length !== ids.length) {
    throw HttpError.badRequest('One or more linked licenses were not found');
  }
}

/** Replace junction rows + keep legacy assets.license_id as first (compat). */
async function syncAssetLicenses(client, assetId, licenseIds) {
  const { assertCanLinkAsset } = require('./licenseService');
  await assertLicensesExist(client, licenseIds);
  // Drop this asset's links first so re-linking the same licenses doesn't
  // count against seat capacity, then enforce pool size for each new link.
  await client.query('DELETE FROM asset_licenses WHERE asset_id = $1', [assetId]);
  for (const lid of licenseIds) {
    await assertCanLinkAsset(client, lid, { excludeAssetId: assetId });
    await client.query(
      'INSERT INTO asset_licenses (asset_id, license_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [assetId, lid]
    );
  }
  await client.query(
    'UPDATE assets SET license_id = $2, updated_at = now() WHERE id = $1',
    [assetId, licenseIds[0] || null]
  );
}

function formatRackUnitLabel(start, size) {
  if (start == null) return null;
  const s = size && size > 1 ? size : 1;
  return s <= 1 ? String(start) : `${start}-${start + s - 1}`;
}

function applyRackCoordinates(data) {
  if (data.rack_u_start === undefined && data.rack_u_size === undefined) return;
  if (data.rack_u_start !== undefined) {
    if (data.rack_u_start == null) {
      data.rack_u_start = null;
      data.rack_u_size = null;
      data.rack_unit = null;
      return;
    }
    const size = data.rack_u_size != null && data.rack_u_size > 0 ? data.rack_u_size : 1;
    data.rack_u_size = size;
    if (data.rack_u_start + size - 1 > 60) {
      throw HttpError.badRequest('Rack placement exceeds U60');
    }
    data.rack_unit = formatRackUnitLabel(data.rack_u_start, size);
  }
}

/** Attach related licenses + parent summaries. */
function mapAssetRow(row) {
  const a = mapAsset(row);
  if (!a) return null;

  let licenses = [];
  const rawLic = row.related_licenses_json;
  if (Array.isArray(rawLic)) licenses = rawLic;
  else if (typeof rawLic === 'string') {
    try { licenses = JSON.parse(rawLic) || []; } catch { licenses = []; }
  }
  a.relatedLicenses = licenses;
  a.relatedLicense = licenses[0] || null;
  a.licenseIds = licenses.map((l) => l.id);
  delete a.licenseSoftwareName;
  delete a.licenseExpirationDate;
  delete a.licenseVendor;
  delete a.relatedLicensesJson;

  if (row.parent_asset_id && row.parent_asset_tag) {
    a.parentAsset = {
      id: row.parent_asset_id,
      assetTag: row.parent_asset_tag,
      brand: row.parent_brand || null,
      model: row.parent_model || null,
      category: row.parent_category || null,
    };
  } else {
    a.parentAsset = null;
  }
  delete a.parentAssetTag;
  delete a.parentBrand;
  delete a.parentModel;
  delete a.parentCategory;
  return a;
}

const ASSET_SELECT = `SELECT a.*,
  p.asset_tag AS parent_asset_tag,
  p.brand AS parent_brand,
  p.model AS parent_model,
  p.category AS parent_category,
  cm.lifecycle_months AS model_lifecycle_months,
  COALESCE(lic.related_licenses, '[]'::json) AS related_licenses_json
 FROM assets a
 LEFT JOIN assets p ON p.id = a.parent_asset_id
 LEFT JOIN catalog_models cm ON cm.category = a.category AND cm.brand = a.brand AND cm.model = a.model
 LEFT JOIN LATERAL (
   SELECT json_agg(json_build_object(
     'id', lx.id,
     'softwareName', lx.software_name,
     'expirationDate', lx.expiration_date,
     'vendor', lx.vendor
   ) ORDER BY lx.software_name) AS related_licenses
   FROM asset_licenses al
   JOIN licenses lx ON lx.id = al.license_id
   WHERE al.asset_id = a.id
 ) lic ON true`;

function sanitize(body, { partial = false } = {}) {
  const {
    assetTag, serialNumber, brand, model, category,
    macEthernet, macWifi, specs, status, warrantyEndDate, location,
  } = body;

  if (!partial) {
    for (const [name, value] of Object.entries({ serialNumber, brand, model, category })) {
      if (!value || typeof value !== 'string') {
        throw HttpError.badRequest(`Field "${name}" is required and must be a string`);
      }
    }
  }
  if (status !== undefined && !STATUSES.includes(status)) {
    throw HttpError.badRequest(`Invalid status "${status}". Must be one of: ${STATUSES.join(', ')}`);
  }

  const data = {};
  if (!partial && assetTag) data.asset_tag = String(assetTag).trim().slice(0, 64);
  if (serialNumber !== undefined) data.serial_number = serialNumber.trim();
  if (brand !== undefined) data.brand = brand;
  if (model !== undefined) data.model = model;
  if (category !== undefined) data.category = category;
  if (macEthernet !== undefined) data.mac_ethernet = macEthernet;
  if (macWifi !== undefined) data.mac_wifi = macWifi;
  if (status !== undefined) data.status = status;
  if (warrantyEndDate !== undefined) {
    data.warranty_end_date = warrantyEndDate ? new Date(warrantyEndDate) : null;
  }
  if (body.purchaseDate !== undefined) {
    data.purchase_date = body.purchaseDate ? new Date(body.purchaseDate) : null;
  }
  if (body.lifecycleMonths !== undefined) {
    const m = body.lifecycleMonths === '' || body.lifecycleMonths == null ? null : Number(body.lifecycleMonths);
    if (m !== null && (!Number.isInteger(m) || m < 1 || m > 240)) {
      throw HttpError.badRequest('lifecycleMonths must be an integer between 1 and 240');
    }
    data.lifecycle_months = m;
  }
  if (specs !== undefined) {
    data.specs = JSON.stringify({
      cpu: specs?.cpu || null,
      ram: specs?.ram || null,
      storage: specs?.storage || null,
      os: specs?.os || null,
      hostname: specs?.hostname || null,
      ipAddress: specs?.ipAddress || null,
    });
  }
  if (location !== undefined) data.location = location ? String(location).trim() : null;
  if (body.notes !== undefined) {
    data.notes = body.notes == null ? '' : String(body.notes).trim().slice(0, 2000);
  }

  // Multi-license preferred; single licenseId still accepted for older clients.
  if (body.licenseIds !== undefined) {
    data._licenseIds = normalizeLicenseIds(body.licenseIds);
  } else if (body.licenseId !== undefined) {
    data._licenseIds = normalizeLicenseIds(
      body.licenseId === null || body.licenseId === '' ? [] : [body.licenseId]
    );
  }

  if (body.responsibleEmployeeId !== undefined) {
    data._responsibleEmployeeId = body.responsibleEmployeeId === null || body.responsibleEmployeeId === ''
      ? null
      : body.responsibleEmployeeId;
  }
  if (body.infraRole !== undefined) {
    if (body.infraRole === null || body.infraRole === '') data.infra_role = null;
    else if (!INFRA_ROLES.has(String(body.infraRole))) {
      throw HttpError.badRequest(`Invalid infraRole. Must be one of: ${[...INFRA_ROLES].join(', ')}`);
    } else data.infra_role = String(body.infraRole);
  }
  if (body.rack !== undefined) {
    data.rack = body.rack ? String(body.rack).trim().slice(0, 80) : null;
  }
  if (body.rackUStart !== undefined) {
    if (body.rackUStart === null || body.rackUStart === '') data.rack_u_start = null;
    else {
      const n = Number(body.rackUStart);
      if (!Number.isInteger(n) || n < 1 || n > 60) {
        throw HttpError.badRequest('rackUStart must be an integer between 1 and 60');
      }
      data.rack_u_start = n;
    }
  }
  if (body.rackUSize !== undefined) {
    if (body.rackUSize === null || body.rackUSize === '') data.rack_u_size = null;
    else {
      const n = Number(body.rackUSize);
      if (!Number.isInteger(n) || n < 1 || n > 20) {
        throw HttpError.badRequest('rackUSize must be an integer between 1 and 20');
      }
      data.rack_u_size = n;
    }
  }
  // Legacy free-text rackUnit still accepted when numeric fields omitted.
  if (body.rackUnit !== undefined && body.rackUStart === undefined) {
    data.rack_unit = body.rackUnit ? String(body.rackUnit).trim().slice(0, 40) : null;
  }
  if (body.firmwareVersion !== undefined) {
    data.firmware_version = body.firmwareVersion
      ? String(body.firmwareVersion).trim().slice(0, 120) : null;
  }
  if (body.firmwareUpdatedAt !== undefined) {
    data.firmware_updated_at = body.firmwareUpdatedAt ? new Date(body.firmwareUpdatedAt) : null;
  }
  if (body.mgmtIp !== undefined) {
    data.mgmt_ip = body.mgmtIp ? String(body.mgmtIp).trim().slice(0, 80) : null;
  }
  if (body.parentAssetId !== undefined) {
    data._parentAssetId = body.parentAssetId === null || body.parentAssetId === ''
      ? null
      : body.parentAssetId;
  }

  applyRackCoordinates(data);
  return data;
}

async function nextAssetTag() {
  const { rows } = await query(
    `SELECT COALESCE(MAX(substring(asset_tag FROM '^IT-([0-9]+)$')::int), 1000) AS mx
     FROM assets WHERE asset_tag ~ '^IT-[0-9]+$'`
  );
  return 'IT-' + String(rows[0].mx + 1).padStart(4, '0');
}

async function createAsset(body, itUser) {
  const data = sanitize(body);
  const isInfra = INFRA_CATEGORIES.has(data.category);
  if (isInfra) {
    if (!data.asset_tag || !String(data.asset_tag).trim()) {
      throw HttpError.badRequest(
        'Asset tag is required for Network/Server equipment — enter it manually'
      );
    }
    data.asset_tag = String(data.asset_tag).trim().slice(0, 64);
  }
  const autoTag = !isInfra && !data.asset_tag;
  const licenseIds = data._licenseIds !== undefined ? data._licenseIds : [];
  delete data._licenseIds;

  if (data._responsibleEmployeeId !== undefined) {
    Object.assign(data, await resolveResponsibleEmployee(data._responsibleEmployeeId));
    delete data._responsibleEmployeeId;
  } else {
    data.responsible_employee_id = null;
    data.responsible_employee_name = null;
  }

  if (data._parentAssetId !== undefined) {
    Object.assign(data, await resolveParentAsset(data._parentAssetId, null));
    delete data._parentAssetId;
  } else {
    data.parent_asset_id = null;
  }

  assertInfraPlacement({
    category: data.category,
    location: data.location,
    responsible_employee_id: data.responsible_employee_id,
  });

  if (!INFRA_CATEGORIES.has(data.category)) {
    clearInfraFields(data);
  }

  await assertLicensesExist(null, licenseIds);
  data.license_id = licenseIds[0] || null;

  for (let attempt = 0; attempt < 3; attempt++) {
    if (autoTag) data.asset_tag = await nextAssetTag();
    try {
      return await withTransaction(async (t) => {
        const { rows } = await t.query(
          `INSERT INTO assets (asset_tag, serial_number, brand, model, category,
                               mac_ethernet, mac_wifi, specs, status, warranty_end_date, purchase_date, qr_code_string,
                               location, lifecycle_months, notes, license_id,
                               responsible_employee_id, responsible_employee_name,
                               infra_role, rack, rack_unit, rack_u_start, rack_u_size,
                               firmware_version, firmware_updated_at, mgmt_ip, parent_asset_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,'{}'::jsonb),COALESCE($9,'In Stock'),$10,$11,$12,$13,$14,COALESCE($15,''),$16,$17,$18,
                   $19,$20,$21,$22,$23,$24,$25,$26,$27)
           RETURNING id, asset_tag`,
          [
            data.asset_tag, data.serial_number, data.brand, data.model, data.category,
            data.mac_ethernet || null, data.mac_wifi || null, data.specs || null,
            data.status || null, data.warranty_end_date || null, data.purchase_date || null,
            buildQrCodeString(data.asset_tag), data.location || null, data.lifecycle_months ?? null,
            data.notes || '', data.license_id || null,
            data.responsible_employee_id || null, data.responsible_employee_name || null,
            data.infra_role || null, data.rack || null, data.rack_unit || null,
            data.rack_u_start ?? null, data.rack_u_size ?? null,
            data.firmware_version || null, data.firmware_updated_at || null,
            data.mgmt_ip || null, data.parent_asset_id || null,
          ]
        );
        const id = rows[0].id;
        if (licenseIds.length) await syncAssetLicenses(t, id, licenseIds);

        const createdNotes = isInfra
          ? [
            data.category,
            data.location ? `location ${data.location}` : null,
            data.responsible_employee_name ? `owner ${data.responsible_employee_name}` : null,
            data.infra_role || null,
          ].filter(Boolean).join(' · ')
          : `${data.category || 'Hardware'} · ${data.brand || ''} ${data.model || ''}`.trim();

        await insertAssetHistory(t, {
          assetId: id,
          assetTag: rows[0].asset_tag,
          actionType: 'created',
          notes: createdNotes,
          employeeId: data.responsible_employee_id || null,
          employeeName: data.responsible_employee_name || null,
          itUser,
        });

        return { id, assetTag: rows[0].asset_tag };
      });
    } catch (err) {
      if (err.code === '23505') {
        if (autoTag && attempt < 2) continue;
        throw HttpError.conflict(`Asset tag "${data.asset_tag}" is already registered`);
      }
      throw err;
    }
  }
}

async function updateAsset(assetId, body, itUser) {
  if (!isUuid(assetId)) throw HttpError.notFound(`Asset ${assetId} not found`);
  const data = sanitize(body, { partial: true });
  const licenseIds = data._licenseIds;
  delete data._licenseIds;

  if (data._responsibleEmployeeId !== undefined) {
    Object.assign(data, await resolveResponsibleEmployee(data._responsibleEmployeeId));
    delete data._responsibleEmployeeId;
  }

  if (data._parentAssetId !== undefined) {
    Object.assign(data, await resolveParentAsset(data._parentAssetId, assetId));
    delete data._parentAssetId;
  }

  if (Object.keys(data).length === 0 && licenseIds === undefined) {
    throw HttpError.badRequest('No updatable fields provided');
  }

  return withTransaction(async (t) => {
    const { rows } = await t.query('SELECT * FROM assets WHERE id = $1 FOR UPDATE', [assetId]);
    const current = rows[0];
    if (!current) throw HttpError.notFound(`Asset ${assetId} not found`);

    if (data.status === 'Assigned' && current.status !== 'Assigned') {
      throw HttpError.badRequest('Use POST /api/handovers to assign assets');
    }

    const nextCategoryEarly = data.category !== undefined ? data.category : current.category;
    if (data.status === 'Sold' && INFRA_CATEGORIES.has(nextCategoryEarly)) {
      throw HttpError.badRequest('Network/Server equipment cannot be marked as Sold — use Scrap instead');
    }
    if (data.status === 'Reserved' && INFRA_CATEGORIES.has(nextCategoryEarly)) {
      throw HttpError.badRequest('Network/Server equipment cannot be Reserved');
    }
    if (data.status === 'Scrap' && current.status === 'Reserved') {
      throw HttpError.conflict('Release the onboarding reservation before scrapping this asset');
    }
    if (data.status === 'Sold' && current.status === 'Reserved') {
      throw HttpError.conflict('Release the onboarding reservation before marking this asset as Sold');
    }

    // When marking Sold with sale metadata, append it to the asset note + history.
    const becomingSold = data.status === 'Sold' && current.status !== 'Sold';
    let saleMeta = null;
    if (becomingSold) {
      saleMeta = normalizeSale(body.sale, { required: false });
      if (saleMeta) {
        const baseNotes = data.notes !== undefined ? data.notes : current.notes;
        data.notes = appendSaleToNotes(baseNotes, saleMeta);
      }
    }

    const nextCategory = data.category !== undefined ? data.category : current.category;
    if (INFRA_CATEGORIES.has(nextCategory)) {
      const touchingPlacement = data.location !== undefined
        || data.responsible_employee_id !== undefined
        || data.category !== undefined;
      if (touchingPlacement) {
        assertInfraPlacement({
          category: nextCategory,
          location: data.location !== undefined ? data.location : current.location,
          responsible_employee_id: data.responsible_employee_id !== undefined
            ? data.responsible_employee_id
            : current.responsible_employee_id,
        });
      }
    } else if (data.category !== undefined && INFRA_CATEGORIES.has(current.category)) {
      data.responsible_employee_id = null;
      data.responsible_employee_name = null;
      clearInfraFields(data);
      if (licenseIds === undefined) {
        await syncAssetLicenses(t, assetId, []);
      }
    }

    const unassignStatuses = ['In Stock', 'Scrap', 'Sold'];
    const clearsAssignment =
      data.status !== undefined &&
      unassignStatuses.includes(data.status) &&
      current.status === 'Assigned' &&
      current.current_employee_id;

    if (clearsAssignment) {
      data.current_employee_id = null;
      data.current_employee_name = null;
    }

    if (licenseIds !== undefined) {
      data.license_id = licenseIds[0] || null;
    }

    let updatedRow = current;
    if (Object.keys(data).length) {
      const cols = Object.keys(data);
      const sets = cols.map((c, i) => `${c} = $${i + 2}`).join(', ');
      try {
        const updated = await t.query(
          `UPDATE assets SET ${sets}, updated_at = now() WHERE id = $1 RETURNING *`,
          [assetId, ...cols.map((c) => data[c])]
        );
        updatedRow = updated.rows[0];
      } catch (err) {
        if (err.code === '23505') {
          throw HttpError.conflict(`Asset tag "${data.asset_tag}" is already registered`);
        }
        throw err;
      }
    }

    if (clearsAssignment) {
      await t.query(
        'UPDATE employees SET active_asset_count = GREATEST(active_asset_count - 1, 0) WHERE id = $1',
        [current.current_employee_id]
      );
    }

    if (licenseIds !== undefined) {
      await syncAssetLicenses(t, assetId, licenseIds);
    }

    await writeUpdateHistory(t, current, updatedRow, data, licenseIds, itUser, saleMeta);

    const { rows: full } = await t.query(`${ASSET_SELECT} WHERE a.id = $1`, [assetId]);
    return mapAssetRow(full[0] || updatedRow);
  });
}

async function writeUpdateHistory(t, before, after, patch, licenseIds, itUser, saleMeta = null) {
  const isInfra = INFRA_CATEGORIES.has(after.category);
  const historyEvents = [];

  const locationChanged = patch.location !== undefined && (before.location || null) !== (after.location || null);
  const ownerChanged = patch.responsible_employee_id !== undefined
    && (before.responsible_employee_id || null) !== (after.responsible_employee_id || null);
  const statusChanged = patch.status !== undefined && before.status !== after.status;

  if (locationChanged || ownerChanged) {
    const bits = [];
    if (locationChanged) bits.push(`location: ${before.location || '—'} → ${after.location || '—'}`);
    if (ownerChanged) {
      bits.push(`owner: ${before.responsible_employee_name || '—'} → ${after.responsible_employee_name || '—'}`);
    }
    const note = bits.join(' · ');
    const actionType = locationChanged && ownerChanged
      ? 'placed'
      : (ownerChanged ? 'responsible_changed' : 'placed');

    // New / current owner sees the placement on their employee timeline.
    if (after.responsible_employee_id) {
      historyEvents.push({
        actionType,
        notes: note,
        employeeId: after.responsible_employee_id,
        employeeName: after.responsible_employee_name || null,
      });
    } else {
      // Cleared ownership — still keep an asset timeline row (no employee link).
      historyEvents.push({
        actionType,
        notes: note,
        employeeId: null,
        employeeName: null,
      });
    }

    // Previous owner also gets a timeline entry when responsibility moves away.
    if (
      ownerChanged
      && before.responsible_employee_id
      && before.responsible_employee_id !== after.responsible_employee_id
    ) {
      historyEvents.push({
        actionType: 'responsible_changed',
        notes: `Removed as responsible · ${note}`,
        employeeId: before.responsible_employee_id,
        employeeName: before.responsible_employee_name || null,
      });
    }
  }

  if (statusChanged) {
    const saleBit = saleMeta ? formatSaleSummary(saleMeta) : '';
    const statusNote = saleBit
      ? `${before.status} → ${after.status} · ${saleBit}`
      : `${before.status} → ${after.status}`;
    const actionType = after.status === 'Sold' ? 'sold' : 'status_changed';
    // Link to responsible (infra) and/or assigned employee so both timelines see scrap/stock moves.
    const targets = [];
    if (after.responsible_employee_id || before.responsible_employee_id) {
      targets.push({
        employeeId: after.responsible_employee_id || before.responsible_employee_id,
        employeeName: after.responsible_employee_name || before.responsible_employee_name || null,
      });
    }
    if (before.current_employee_id) {
      const already = targets.some((x) => x.employeeId === before.current_employee_id);
      if (!already) {
        targets.push({
          employeeId: before.current_employee_id,
          employeeName: before.current_employee_name || null,
        });
      }
    }
    if (!targets.length) {
      targets.push({ employeeId: null, employeeName: null });
    }
    for (const tg of targets) {
      historyEvents.push({
        actionType,
        notes: statusNote,
        employeeId: tg.employeeId,
        employeeName: tg.employeeName,
      });
    }
  }

  // General inventory edits (brand/model/firmware/rack/notes/…) — skip empty no-op patches.
  const detailFields = [
    { key: 'brand', label: 'brand' },
    { key: 'model', label: 'model' },
    { key: 'serial_number', label: 'serial' },
    { key: 'category', label: 'category' },
    { key: 'infra_role', label: 'role' },
    { key: 'rack', label: 'rack' },
    { key: 'rack_unit', label: 'U' },
    { key: 'rack_u_start', label: 'U start' },
    { key: 'rack_u_size', label: 'U size' },
    { key: 'firmware_version', label: 'firmware' },
    { key: 'mgmt_ip', label: 'mgmt IP' },
    // Sale append already logged on the sold history row.
    ...(saleMeta ? [] : [{ key: 'notes', label: 'notes' }]),
    { key: 'asset_tag', label: 'tag' },
  ];
  const detailDiffs = describeFieldDiffs(before, after, detailFields);
  if (licenseIds !== undefined) detailDiffs.push('linked licenses updated');

  // Avoid duplicate noise when the only changes were placement/status already logged above.
  const patchKeys = Object.keys(patch);
  const companionKeys = ['location', 'responsible_employee_id', 'responsible_employee_name', 'status',
    'current_employee_id', 'current_employee_name'];
  if (saleMeta) companionKeys.push('notes');
  const placementOnly = patchKeys.every((k) => companionKeys.includes(k));
  if (detailDiffs.length && !(placementOnly && !licenseIds)) {
    historyEvents.push({
      actionType: 'updated',
      notes: detailDiffs.slice(0, 8).join(' · '),
      employeeId: isInfra
        ? (after.responsible_employee_id || null)
        : (after.current_employee_id || null),
      employeeName: isInfra
        ? (after.responsible_employee_name || null)
        : (after.current_employee_name || null),
    });
  }

  for (const ev of historyEvents) {
    await insertAssetHistory(t, {
      assetId: after.id,
      assetTag: after.asset_tag,
      actionType: ev.actionType,
      notes: ev.notes,
      employeeId: ev.employeeId,
      employeeName: ev.employeeName,
      itUser,
    });
  }
}

async function listAssets({
  status, category, categories, employeeId, responsibleEmployeeId,
  infraRole, search, location, limit = 100, offset = 0,
} = {}) {
  const where = [];
  const params = [];

  const asList = (v) => (Array.isArray(v) ? v : String(v || '').split(','))
    .map((x) => String(x).trim()).filter(Boolean);

  if (status) {
    const list = asList(status);
    if (list.length === 1) { params.push(list[0]); where.push(`a.status = $${params.length}`); }
    else if (list.length > 1) { params.push(list); where.push(`a.status = ANY($${params.length}::text[])`); }
  }
  if (category) { params.push(category); where.push(`a.category = $${params.length}`); }
  if (categories) {
    const list = asList(categories);
    if (list.length) {
      params.push(list);
      where.push(`a.category = ANY($${params.length}::text[])`);
    }
  }
  if (employeeId) {
    if (!isUuid(employeeId)) return { items: [], nextCursor: null };
    params.push(employeeId);
    where.push(`a.current_employee_id = $${params.length}`);
  }
  if (responsibleEmployeeId) {
    const ids = asList(responsibleEmployeeId);
    if (!ids.length || ids.some((id) => !isUuid(id))) return { items: [], total: 0, nextCursor: null };
    if (ids.length === 1) {
      params.push(ids[0]);
      where.push(`a.responsible_employee_id = $${params.length}`);
    } else {
      params.push(ids);
      where.push(`a.responsible_employee_id = ANY($${params.length}::uuid[])`);
    }
  }
  if (infraRole) {
    const list = asList(infraRole);
    if (list.length === 1) { params.push(list[0]); where.push(`a.infra_role = $${params.length}`); }
    else if (list.length > 1) { params.push(list); where.push(`a.infra_role = ANY($${params.length}::text[])`); }
  }
  if (location) {
    const list = asList(location);
    if (list.length === 1) { params.push(list[0]); where.push(`a.location = $${params.length}`); }
    else if (list.length > 1) { params.push(list); where.push(`a.location = ANY($${params.length}::text[])`); }
  }
  if (search) {
    params.push(`%${search}%`);
    where.push(
      `(a.asset_tag ILIKE $${params.length} OR a.serial_number ILIKE $${params.length} ` +
      `OR a.brand ILIKE $${params.length} OR a.model ILIKE $${params.length} ` +
      `OR a.mac_ethernet ILIKE $${params.length} OR a.mac_wifi ILIKE $${params.length} ` +
      `OR COALESCE(a.mgmt_ip,'') ILIKE $${params.length} ` +
      `OR COALESCE(a.rack,'') ILIKE $${params.length} ` +
      `OR COALESCE(a.infra_role,'') ILIKE $${params.length} ` +
      `OR COALESCE(a.specs->>'hostname','') ILIKE $${params.length} ` +
      `OR COALESCE(a.specs->>'ipAddress','') ILIKE $${params.length})`
    );
  }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const totalRes = await query(`SELECT COUNT(*)::int AS n FROM assets a ${whereSql}`, [...params]);

  params.push(Math.min(Number(limit) || 100, 2000), Number(offset) || 0);
  const { rows } = await query(
    `${ASSET_SELECT} ${whereSql}
     ORDER BY a.asset_tag LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return { items: rows.map(mapAssetRow), total: totalRes.rows[0].n, nextCursor: null };
}

async function getAsset(assetId) {
  if (!isUuid(assetId)) throw HttpError.notFound(`Asset ${assetId} not found`);
  const { rows } = await query(`${ASSET_SELECT} WHERE a.id = $1`, [assetId]);
  if (!rows[0]) throw HttpError.notFound(`Asset ${assetId} not found`);

  const history = await query(
    'SELECT * FROM asset_history WHERE asset_id = $1 ORDER BY "timestamp" DESC LIMIT 25',
    [assetId]
  );
  return { ...mapAssetRow(rows[0]), history: mapRows(history.rows) };
}

async function returnAsset(assetId, { conditionNote } = {}, itUser) {
  if (!isUuid(assetId)) throw HttpError.notFound(`Asset ${assetId} not found`);

  return withTransaction(async (t) => {
    const { rows } = await t.query('SELECT * FROM assets WHERE id = $1 FOR UPDATE', [assetId]);
    const asset = rows[0];
    if (!asset) throw HttpError.notFound(`Asset ${assetId} not found`);
    if (asset.status !== 'Assigned' || !asset.current_employee_id) {
      throw HttpError.conflict(`Asset ${asset.asset_tag} is not currently assigned`);
    }

    await t.query(
      `UPDATE assets SET status = 'In Stock', current_employee_id = NULL,
              current_employee_name = NULL, updated_at = now() WHERE id = $1`,
      [assetId]
    );
    await t.query(
      'UPDATE employees SET active_asset_count = active_asset_count - 1 WHERE id = $1',
      [asset.current_employee_id]
    );
    await t.query(
      `INSERT INTO asset_history
         (asset_id, asset_tag, employee_id, employee_name, action_type, notes, changed_by, changed_by_name)
       VALUES ($1, $2, $3, $4, 'returned', $5, $6, $7)`,
      [assetId, asset.asset_tag, asset.current_employee_id, asset.current_employee_name,
       conditionNote || '', itUser.uid, itUser.username || itUser.email]
    );

    return { id: assetId, assetTag: asset.asset_tag, status: 'In Stock' };
  });
}

module.exports = { createAsset, updateAsset, listAssets, getAsset, returnAsset, nextAssetTag };
