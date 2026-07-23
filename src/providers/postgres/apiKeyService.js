/** Service-account API keys (hashed). Prefix itacm_ used for lookup. */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { query } = require('./pool');
const { HttpError } = require('../../utils/httpError');
const { ROLES } = require('../../utils/permissions');
const { isUuid } = require('./rowMapper');

function generateRawKey() {
  const body = crypto.randomBytes(24).toString('base64url');
  return `itacm_${body}`;
}

async function listKeys() {
  const { rows } = await query(
    `SELECT id, name, key_prefix AS "keyPrefix", role, scopes, created_by AS "createdBy",
            last_used_at AS "lastUsedAt", revoked_at AS "revokedAt", created_at AS "createdAt"
     FROM api_keys ORDER BY created_at DESC`
  );
  return rows;
}

async function createKey({ name, role = 'Helpdesk', scopes = ['*'] }, actor) {
  const nm = String(name || '').trim().slice(0, 80);
  if (!nm) throw HttpError.badRequest('name is required');
  if (!ROLES.includes(role)) throw HttpError.badRequest('Invalid role');
  // Portal is a self-service *human* login confined to /api/me by middleware.
  // A service key must never carry it — see verifyRawKey for the read-side guard.
  if (role === 'Portal') {
    throw HttpError.badRequest('Portal is a self-service login role and cannot back an API key');
  }
  if ((role === 'Owner' || role === 'Admin') && actor?.role !== 'Owner') {
    throw HttpError.forbidden('Only Owner can create Owner/Admin-scoped API keys');
  }
  const raw = generateRawKey();
  const prefix = raw.slice(0, 14);
  const hash = await bcrypt.hash(raw, 12);
  const allowedScopes = new Set([
    '*',
    'sync:employees',
    'sync:assets',
    'sync:software',
    'read',
  ]);
  const scopeArr = Array.isArray(scopes) && scopes.length
    ? scopes.map(String).filter((s) => allowedScopes.has(s)).slice(0, 20)
    : ['*'];
  if (!scopeArr.length) scopeArr.push('*');
  const { rows } = await query(
    `INSERT INTO api_keys (name, key_prefix, key_hash, role, scopes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING id, name, key_prefix AS "keyPrefix", role, scopes, created_at AS "createdAt"`,
    [nm, prefix, hash, role, scopeArr, actor?.email || actor?.username || null]
  );
  return { ...rows[0], apiKey: raw, warning: 'Copy this key now — it will not be shown again.' };
}

async function revokeKey(id, actor) {
  if (!isUuid(id)) throw HttpError.notFound('API key not found');
  const { rows } = await query(
    `UPDATE api_keys SET revoked_at = now()
     WHERE id = $1 AND revoked_at IS NULL
     RETURNING id`,
    [id]
  );
  if (!rows[0]) throw HttpError.notFound('API key not found or already revoked');
  return { id, revoked: true, by: actor?.email || null };
}

async function verifyRawKey(raw) {
  if (!raw || !String(raw).startsWith('itacm_')) return null;
  const prefix = String(raw).slice(0, 14);
  const { rows } = await query(
    `SELECT ak.*,
            u.status AS linked_user_status,
            u.permission_group_id AS linked_permission_group_id,
            u.custom_constraints AS linked_custom_constraints
     FROM api_keys ak
     LEFT JOIN users u ON u.email = ak.created_by
     WHERE ak.key_prefix = $1 AND ak.revoked_at IS NULL`,
    [prefix]
  );
  for (const row of rows) {
    if (await bcrypt.compare(raw, row.key_hash)) {
      // Disabled kullanıcıya bağlı API key çalışmasın
      if (row.linked_user_status === 'Disabled') return null;
      // Defence in depth: reject any pre-existing row that still carries the
      // Portal role (createKey now refuses it, older rows may not have).
      if (row.role === 'Portal') return null;

      await query('UPDATE api_keys SET last_used_at = now() WHERE id = $1', [row.id]).catch(() => {});
      return {
        uid: `apikey:${row.id}`,
        email: `apikey:${row.key_prefix}`,
        username: row.name || 'API Key',
        role: row.role,
        mfaEnabled: false,
        jti: null,
        tokenExp: null,
        actorType: 'service',
        scopes: row.scopes || ['*'],
        apiKeyId: row.id,
        permissionGroupId: row.linked_permission_group_id || null,
        customConstraints: row.linked_custom_constraints || null,
      };
    }
  }
  return null;
}

module.exports = { listKeys, createKey, revokeKey, verifyRawKey };

