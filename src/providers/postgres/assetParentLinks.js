/**
 * Many-to-many Network/Server parent links (HA / dual-uplink topologies).
 * assets.parent_asset_id stays as a denormalized primary parent for legacy readers.
 */
'use strict';

const { HttpError } = require('../../utils/httpError');
const { isUuid } = require('./rowMapper');

const INFRA_CATEGORIES = new Set(['Network', 'Server']);
const MAX_ASSET_PARENTS = 8;

function normalizeParentIdList(raw) {
  if (raw == null) return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  const out = [];
  const seen = new Set();
  for (const item of arr) {
    if (item == null || item === '') continue;
    const id = String(item);
    if (!isUuid(id)) throw HttpError.badRequest('parentAssetId must be a valid UUID');
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  if (out.length > MAX_ASSET_PARENTS) {
    throw HttpError.badRequest(`A device can have at most ${MAX_ASSET_PARENTS} parents`);
  }
  return out;
}

/** Parse parentAssetIds[] and/or legacy singular parentAssetId. undefined = not provided. */
function parseParentIdsFromBody(body) {
  if (!body || typeof body !== 'object') return undefined;
  if (body.parentAssetIds !== undefined) {
    if (!Array.isArray(body.parentAssetIds) && body.parentAssetIds !== null) {
      throw HttpError.badRequest('parentAssetIds must be an array of asset UUIDs');
    }
    return normalizeParentIdList(body.parentAssetIds || []);
  }
  if (body.parentAssetId !== undefined) {
    if (body.parentAssetId === null || body.parentAssetId === '') return [];
    return normalizeParentIdList([body.parentAssetId]);
  }
  return undefined;
}

async function assertNoParentCycle(db, childId, parentIds) {
  for (const parentId of parentIds) {
    const seen = new Set();
    const queue = [parentId];
    while (queue.length) {
      const id = queue.shift();
      if (id === childId) {
        throw HttpError.badRequest('Circular parent relationship is not allowed');
      }
      if (seen.has(id)) continue;
      seen.add(id);
      const { rows } = await db.query(
        'SELECT parent_asset_id FROM asset_parent_links WHERE child_asset_id = $1',
        [id]
      );
      for (const row of rows) queue.push(row.parent_asset_id);
      const { rows: legacy } = await db.query(
        'SELECT parent_asset_id FROM assets WHERE id = $1 AND parent_asset_id IS NOT NULL',
        [id]
      );
      if (legacy[0] && legacy[0].parent_asset_id) queue.push(legacy[0].parent_asset_id);
      if (seen.size > 500) {
        throw HttpError.badRequest('Circular parent relationship is not allowed');
      }
    }
  }
}

async function syncAssetParents(db, childId, parentIds) {
  const ids = normalizeParentIdList(parentIds);
  if (ids.includes(childId)) {
    throw HttpError.badRequest('A device cannot be its own parent');
  }
  if (ids.length) {
    const { rows } = await db.query(
      'SELECT id, category FROM assets WHERE id = ANY($1::uuid[])',
      [ids]
    );
    if (rows.length !== ids.length) {
      throw HttpError.badRequest('One or more parent devices were not found');
    }
    for (const row of rows) {
      if (!INFRA_CATEGORIES.has(row.category)) {
        throw HttpError.badRequest('Parent device must be Network or Server equipment');
      }
    }
    await assertNoParentCycle(db, childId, ids);
  }

  await db.query('DELETE FROM asset_parent_links WHERE child_asset_id = $1', [childId]);
  if (ids.length) {
    await db.query(
      `INSERT INTO asset_parent_links (child_asset_id, parent_asset_id)
       SELECT $1, x FROM unnest($2::uuid[]) AS x
       ON CONFLICT DO NOTHING`,
      [childId, ids]
    );
  }

  const { rows: primary } = await db.query(
    `SELECT p.id
       FROM asset_parent_links l
       JOIN assets p ON p.id = l.parent_asset_id
      WHERE l.child_asset_id = $1
      ORDER BY p.asset_tag
      LIMIT 1`,
    [childId]
  );
  const primaryId = primary[0] ? primary[0].id : null;
  await db.query(
    'UPDATE assets SET parent_asset_id = $2, updated_at = now() WHERE id = $1',
    [childId, primaryId]
  );
  return primaryId;
}

module.exports = {
  MAX_ASSET_PARENTS,
  normalizeParentIdList,
  parseParentIdsFromBody,
  syncAssetParents,
};
