/**
 * Permission Service — Granüler IAM (Identity & Access Management).
 *
 * Mevcut RBAC yapısının (Owner/Admin/Helpdesk/Viewer) üzerine inşa edilmiş,
 * kaynak-tabanlı, constraint destekli bir izin sistemi.
 *
 * Kullanım:
 *   const { permissionService } = require('../services');
 *   const canAccess = await permissionService.checkPermission(
 *     req.user, 'asset', 'create', { department: 'IT' }
 *   );
 *
 * Built-in sistem grupları (UUID'ler sabit):
 *   Owner   → 00000000-0000-0000-0000-000000000001
 *   Admin   → 00000000-0000-0000-0000-000000000002
 *   Helpdesk → 00000000-0000-0000-0000-000000000003
 *   Viewer  → 00000000-0000-0000-0000-000000000004
 */
const { query } = require('./pool');
const { HttpError } = require('../../utils/httpError');
const {
  RESOURCES,
  ACTIONS,
  ACTIONS_BY_RESOURCE,
  MANAGE_EXPAND,
  isValidResourceAction,
  getIamSchema,
} = require('../../utils/iamSchema');

// ====================================================================
// PERMISSION CACHE — Her istekte SQL sorgusunu önle (DoS koruması)
// TTL: 5 dakika, maksimum 500 entry
// ====================================================================
const permissionCache = new Map();
const CACHE_TTL = 5 * 60 * 1000;
const CACHE_MAX_SIZE = 500;

function getCacheKey(userId, resource, action) {
  return `${userId}::${resource}::${action}`;
}

function getFromCache(userId, resource, action) {
  const key = getCacheKey(userId, resource, action);
  const entry = permissionCache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.timestamp > CACHE_TTL) {
    permissionCache.delete(key);
    return undefined;
  }
  return entry.value;
}

function setToCache(userId, resource, action, value) {
  if (permissionCache.size >= CACHE_MAX_SIZE) {
    const entries = [...permissionCache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
    entries.slice(0, 50).forEach(([k]) => permissionCache.delete(k));
  }
  const key = getCacheKey(userId, resource, action);
  permissionCache.set(key, { value, timestamp: Date.now() });
}

function clearPermissionCache(userId) {
  if (userId) {
    for (const key of permissionCache.keys()) {
      if (key.startsWith(`${userId}::`)) permissionCache.delete(key);
    }
  } else {
    permissionCache.clear();
  }
}
// ====================================================================

// Built-in grup UUID'leri
const SYSTEM_GROUPS = Object.freeze({
  OWNER: '00000000-0000-0000-0000-000000000001',
  ADMIN: '00000000-0000-0000-0000-000000000002',
  HELPDESK: '00000000-0000-0000-0000-000000000003',
  VIEWER: '00000000-0000-0000-0000-000000000004',
});

// Geçerli constraint tipleri
const CONSTRAINT_TYPES = Object.freeze([
  'department', 'location', 'category', 'cost_limit',
  'seats_limit', 'max_assets', 'owner_only',
]);

/**
 * Owner rolü her şeye erişebilir.
 */
function isOwner(user) {
  return user && (user.role === 'Owner' || user.permissionGroupId === SYSTEM_GROUPS.OWNER);
}

/**
 * Bir kullanıcının belirli bir kaynak + aksiyon için izni olup olmadığını
 * kontrol eder. Owner rolü her zaman true döner.
 *
 * @param {Object} user - req.user nesnesi { uid, email, role, permissionGroupId, customConstraints }
 * @param {string} resource - 'asset', 'license', 'employee' vb.
 * @param {string} action - 'read', 'create', 'update', 'delete' vb.
 * @param {Object} [context] - İsteğe bağlı bağlam bilgisi { department, location, category, cost }
 * @returns {Promise<boolean>}
 */
async function checkPermission(user, resource, action, context = {}) {
  if (!user) return false;
  if (isOwner(user)) return true;

  const groupId = user.permissionGroupId;

  // Eğer kullanıcı bir izin grubuna bağlı değilse, rol bazlı fallback
  if (!groupId) {
    return checkRoleFallback(user, resource, action);
  }

  // İzin grubundan kayıtları al
  const { rows: entries } = await query(
    `SELECT constraint_type, constraint_value
     FROM permission_entries
     WHERE group_id = $1 AND resource = $2 AND action = $3`,
    [groupId, resource, action]
  );

  // Hiçbir izin kaydı bulunamadıysa → izin yok
  // (Admin/Owner fallback ONLY when user has no permission group assigned)
  if (entries.length === 0) {
    return false;
  }

  // Tüm constraint'leri kontrol et
  // Eğer hiç constraint yoksa (constraint_type NULL) → doğrudan izin var
  const hasUnconstrained = entries.some(e => !e.constraint_type);
  if (hasUnconstrained) return true;

  // Constraint'leri kontrol et
  for (const entry of entries) {
    if (await evaluateConstraint(entry, user, context)) {
      return true;
    }
  }

  return false;
}

/**
 * Constraint değerlendirmesi.
 */
async function evaluateConstraint(entry, user, context) {
  const { constraint_type, constraint_value } = entry;
  if (!constraint_type || !constraint_value) return true;

  // Kullanıcıya özel custom_constraints varsa, bunlar constraint değerlerini geçersiz kılabilir
  const effectiveConstraints = mergeConstraints(constraint_value, user.customConstraints);

  switch (constraint_type) {
    case 'department': {
      if (!context.department) return false;
      const allowed = Array.isArray(effectiveConstraints)
        ? effectiveConstraints.map(s => s.toLowerCase())
        : [];
      return allowed.includes(context.department.toLowerCase());
    }

    case 'location': {
      if (!context.location) return false;
      const allowed = Array.isArray(effectiveConstraints)
        ? effectiveConstraints.map(s => s.toLowerCase())
        : [];
      return allowed.includes(context.location.toLowerCase());
    }

    case 'category': {
      if (!context.category) return false;
      const allowed = Array.isArray(effectiveConstraints)
        ? effectiveConstraints.map(s => s.toLowerCase())
        : [];
      return allowed.includes(context.category.toLowerCase());
    }

    case 'cost_limit': {
      if (context.cost == null) return true; // cost yoksa limit kontrolü yapma
      const limit = Number(effectiveConstraints);
      return Number(context.cost) <= limit;
    }

    case 'seats_limit': {
      if (context.seats == null) return true;
      const limit = Number(effectiveConstraints);
      return Number(context.seats) <= limit;
    }

    case 'max_assets': {
      if (context.assetCount == null) return true;
      const limit = Number(effectiveConstraints);
      return Number(context.assetCount) <= limit;
    }

    case 'owner_only': {
      if (effectiveConstraints === true || effectiveConstraints === 'true') {
        // Sadece kullanıcının kendi oluşturduğu kayıtlara erişim
        if (!context.createdBy) return false;
        return String(context.createdBy) === String(user.uid);
      }
      return true;
    }

    default:
      return false;
  }
}

/**
 * Kullanıcının custom_constraints'ini constraint_value ile birleştirir.
 * Kullanıcı bazlı constraint'ler, grup constraint'lerini genişletir (override değil).
 */
function mergeConstraints(groupValue, customConstraints) {
  if (!customConstraints) return groupValue;

  // Array tipindeki constraint'ler için (department, location, category) birleştir
  if (Array.isArray(groupValue) && Array.isArray(customConstraints)) {
    const merged = [...new Set([...groupValue, ...customConstraints])];
    return merged;
  }

  // Sayısal constraint'ler için: kullanıcının değeri daha düşükse onu kullan
  if (typeof groupValue === 'number' && typeof customConstraints === 'number') {
    return Math.min(groupValue, customConstraints);
  }

  return groupValue;
}

/**
 * Rol bazlı fallback — permission_group_id'si olmayan kullanıcılar için.
 */
function checkRoleFallback(user, resource, action) {
  if (!user || !user.role) return false;

  switch (user.role) {
    case 'Owner':
      return true;

    case 'Admin':
      // Admin her şeyi yapabilir ama user_management'te delete ve manage yapamaz
      if (action === 'delete' && resource === 'user_management') return false;
      return true;

    case 'Helpdesk':
      // Helpdesk: asset, license, employee, line, consumable, maintenance, handover, onboarding
      // üzerinde create/update/assign yapabilir
      if (['provider', 'contract'].includes(resource) && action !== 'read') return false;
      if (['report'].includes(resource) && action !== 'read') return false;
      if (['settings', 'user_management', 'integration', 'audit'].includes(resource)) return false;
      if (action === 'delete') return false;
      return true;

    case 'Viewer':
      // Viewer: sadece read
      if (action !== 'read') return false;
      // Viewer settings, user_management, integration göremez
      if (['settings', 'user_management', 'integration', 'audit'].includes(resource)) return false;
      return true;

    default:
      return false;
  }
}

/**
 * Birden çok izin kontrolü (ve mantığı). Tümü true olmalı.
 */
async function checkAllPermissions(user, checks) {
  for (const { resource, action, context } of checks) {
    const ok = await checkPermission(user, resource, action, context);
    if (!ok) return false;
  }
  return true;
}

/**
 * En az bir izin varsa true (veya mantığı).
 */
async function checkAnyPermission(user, checks) {
  for (const { resource, action, context } of checks) {
    const ok = await checkPermission(user, resource, action, context);
    if (ok) return true;
  }
  return false;
}

// ====================================================================
// ADMIN İŞLEMLERİ — Permission gruplarını yönetmek için
// ====================================================================

/**
 * Tüm izin gruplarını listele (sistem + özel).
 */
async function listPermissionGroups() {
  const { rows } = await query(
    `SELECT pg.id, pg.name, pg.description, pg.is_system, pg.created_at,
            (SELECT COUNT(*) FROM users u WHERE u.permission_group_id = pg.id) AS user_count
     FROM permission_groups pg
     ORDER BY pg.is_system DESC, pg.name ASC`
  );
  return rows;
}

/**
 * Bir izin grubunun detayını + tüm permission entry'lerini getir.
 */
async function getPermissionGroup(groupId) {
  const { rows: groups } = await query(
    'SELECT * FROM permission_groups WHERE id = $1',
    [groupId]
  );
  if (!groups[0]) return null;

  const { rows: entries } = await query(
    `SELECT id, resource, action, constraint_type, constraint_value
     FROM permission_entries WHERE group_id = $1
     ORDER BY resource, action`,
    [groupId]
  );

  const { rows: users } = await query(
    `SELECT id AS uid, username, email, role
     FROM users WHERE permission_group_id = $1
     ORDER BY username`,
    [groupId]
  );

  return { ...groups[0], entries, users };
}

/**
 * Yeni bir özel izin grubu oluştur.
 */
async function createPermissionGroup({ name, description }, actor) {
  const nm = String(name || '').trim().slice(0, 80);
  if (!nm) throw HttpError.badRequest('Group name is required (max 80 chars)');
  if (nm.length < 2) throw HttpError.badRequest('Group name must be at least 2 characters');

  const desc = String(description || '').trim().slice(0, 500);

  try {
    const { rows } = await query(
      `INSERT INTO permission_groups (name, description, is_system)
       VALUES ($1, $2, false)
       RETURNING id, name, description, is_system, created_at`,
      [nm, desc]
    );
    return rows[0];
  } catch (err) {
    if (err.code === '23505') throw HttpError.conflict(`Permission group "${nm}" already exists`);
    throw err;
  }
}

/**
 * İzin grubunu güncelle (sistem grupları sadece description güncellenebilir).
 */
async function updatePermissionGroup(groupId, { name, description }, actor) {
  const existing = await getPermissionGroup(groupId);
  if (!existing) throw HttpError.notFound('Permission group not found');

  if (existing.is_system && name && name !== existing.name) {
    throw HttpError.badRequest('Cannot rename system permission groups');
  }

  const nm = name ? String(name).trim().slice(0, 80) : existing.name;
  const desc = description !== undefined
    ? String(description).trim().slice(0, 500)
    : existing.description;

  const { rows } = await query(
    `UPDATE permission_groups SET name = $2, description = $3, updated_at = now()
     WHERE id = $1 RETURNING id, name, description, is_system, created_at`,
    [groupId, nm, desc]
  );

  return rows[0];
}

/**
 * Bir izin grubunu sil (sistem grupları silinemez).
 */
async function deletePermissionGroup(groupId, actor) {
  if (isSystemGroup(groupId)) {
    throw HttpError.badRequest('Cannot delete system permission groups');
  }

  // Gruba bağlı kullanıcıları varsayılan gruplarına ata (rollerine göre)
  await query(
    `UPDATE users SET permission_group_id = (
       CASE role
         WHEN 'Owner' THEN '00000000-0000-0000-0000-000000000001'::uuid
         WHEN 'Admin' THEN '00000000-0000-0000-0000-000000000002'::uuid
         WHEN 'Helpdesk' THEN '00000000-0000-0000-0000-000000000003'::uuid
         WHEN 'Viewer' THEN '00000000-0000-0000-0000-000000000004'::uuid
       END
     )
     WHERE permission_group_id = $1`,
    [groupId]
  );

  const { rows } = await query(
    'DELETE FROM permission_groups WHERE id = $1 RETURNING id, name',
    [groupId]
  );

  return rows[0] || null;
}

/**
 * Bir izin grubuna yeni bir permission entry ekle.
 */
/**
 * Sistem grubu entry'lerini sadece Owner değiştirebilir (custom gruplar serbest).
 */
function assertCanEditGroupEntries(isSystem, actor) {
  if (!isSystem) return;
  if (!actor || actor.role !== 'Owner') {
    throw HttpError.forbidden('Only an Owner can edit built-in (system) permission entries');
  }
}

/**
 * Bir izin grubuna yeni bir permission entry ekle.
 * `manage` (unconstrained) also inserts MANAGE_EXPAND ops for that resource.
 */
async function addPermissionEntry(groupId, { resource, action, constraintType, constraintValue }, actor) {
  if (!RESOURCES.includes(resource)) {
    throw HttpError.badRequest(`Invalid resource "${resource}". Valid: ${RESOURCES.join(', ')}`);
  }
  if (!ACTIONS.includes(action)) {
    throw HttpError.badRequest(`Invalid action "${action}". Valid: ${ACTIONS.join(', ')}`);
  }
  if (!isValidResourceAction(resource, action)) {
    const allowed = ACTIONS_BY_RESOURCE[resource] || [];
    throw HttpError.badRequest(
      `Action "${action}" is not valid for resource "${resource}". Use: ${allowed.join(', ') || '(none)'}`
    );
  }
  if (constraintType && !CONSTRAINT_TYPES.includes(constraintType)) {
    throw HttpError.badRequest(`Invalid constraint type "${constraintType}". Valid: ${CONSTRAINT_TYPES.join(', ')}`);
  }

  const existing = await getPermissionGroup(groupId);
  if (!existing) throw HttpError.notFound('Permission group not found');
  assertCanEditGroupEntries(existing.is_system, actor);

  const ct = constraintType || null;
  const cv = constraintValue !== undefined ? JSON.stringify(constraintValue) : null;

  async function insertOne(res, act) {
    try {
      const { rows } = await query(
        `INSERT INTO permission_entries (group_id, resource, action, constraint_type, constraint_value)
         VALUES ($1, $2, $3, $4, $5::jsonb)
         RETURNING id, resource, action, constraint_type, constraint_value`,
        [groupId, res, act, ct, cv]
      );
      return rows[0];
    } catch (err) {
      if (err.code === '23505') {
        if (res === resource && act === action) {
          throw HttpError.conflict(
            `Permission entry already exists for ${resource}:${action} in this group`
          );
        }
        return null; // expand sibling already present
      }
      throw err;
    }
  }

  try {
    const primary = await insertOne(resource, action);
    // Grant-time expand: manage → ops (not export/import/confidential/view_*)
    if (action === 'manage' && !ct) {
      const expand = MANAGE_EXPAND[resource] || [];
      for (const act of expand) {
        await insertOne(resource, act);
      }
    }
    clearPermissionCache();
    return primary;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw err;
  }
}

/**
 * Bir permission entry'yi güncelle.
 */
async function updatePermissionEntry(entryId, { resource, action, constraintType, constraintValue }, actor) {
  const { rows: existing } = await query(
    'SELECT pe.*, pg.is_system FROM permission_entries pe JOIN permission_groups pg ON pe.group_id = pg.id WHERE pe.id = $1',
    [entryId]
  );
  if (!existing[0]) throw HttpError.notFound('Permission entry not found');

  const entry = existing[0];
  assertCanEditGroupEntries(entry.is_system, actor);

  const resource_ = resource || entry.resource;
  const action_ = action || entry.action;
  if (resource && !RESOURCES.includes(resource_)) {
    throw HttpError.badRequest(`Invalid resource "${resource_}"`);
  }
  if (action && !ACTIONS.includes(action_)) {
    throw HttpError.badRequest(`Invalid action "${action_}"`);
  }
  const ct = constraintType !== undefined ? (constraintType || null) : entry.constraint_type;
  if (ct && !CONSTRAINT_TYPES.includes(ct)) {
    throw HttpError.badRequest(`Invalid constraint type "${ct}"`);
  }
  const cv = constraintValue !== undefined
    ? JSON.stringify(constraintValue)
    : JSON.stringify(entry.constraint_value);

  const { rows } = await query(
    `UPDATE permission_entries
     SET resource = $2, action = $3, constraint_type = $4, constraint_value = $5::jsonb
     WHERE id = $1
     RETURNING id, resource, action, constraint_type, constraint_value`,
    [entryId, resource_, action_, ct, cv]
  );
  clearPermissionCache();
  return rows[0];
}

/**
 * Bir permission entry'yi sil.
 */
async function deletePermissionEntry(entryId, actor) {
  const { rows: existing } = await query(
    'SELECT pe.*, pg.is_system FROM permission_entries pe JOIN permission_groups pg ON pe.group_id = pg.id WHERE pe.id = $1',
    [entryId]
  );
  if (!existing[0]) throw HttpError.notFound('Permission entry not found');
  assertCanEditGroupEntries(existing[0].is_system, actor);

  await query('DELETE FROM permission_entries WHERE id = $1', [entryId]);
  clearPermissionCache();
  return { id: entryId, deleted: true };
}

/**
 * Aynı resource+action için gruptaki tüm entry'leri sil (matrix toggle-off).
 * NULL constraint_type satırları PostgreSQL UNIQUE'te çoğalabildiği için id bazlı tek silme yetmez.
 */
async function deletePermissionEntriesForAction(groupId, resource, action, actor) {
  if (!RESOURCES.includes(resource)) {
    throw HttpError.badRequest(`Invalid resource "${resource}"`);
  }
  if (!ACTIONS.includes(action)) {
    throw HttpError.badRequest(`Invalid action "${action}"`);
  }
  const existing = await getPermissionGroup(groupId);
  if (!existing) throw HttpError.notFound('Permission group not found');
  assertCanEditGroupEntries(existing.is_system, actor);

  const { rowCount } = await query(
    `DELETE FROM permission_entries
     WHERE group_id = $1 AND resource = $2 AND action = $3`,
    [groupId, resource, action]
  );
  clearPermissionCache();
  return { groupId, resource, action, deleted: rowCount || 0 };
}

/**
 * Kullanıcının izin grubunu değiştir.
 */
async function setUserPermissionGroup(userId, groupId, actor) {
  const { rows: users } = await query(
    'SELECT id, role, email, username FROM users WHERE id = $1',
    [userId]
  );
  if (!users[0]) throw HttpError.notFound('User not found');

  const target = users[0];

  if (groupId) {
    const { rows: groups } = await query(
      'SELECT id, name FROM permission_groups WHERE id = $1',
      [groupId]
    );
    if (!groups[0]) throw HttpError.notFound('Permission group not found');
  }

  // Owner rolündeki bir kullanıcıyı başka bir gruba atamaya çalışıyorsa engelle
  if (target.role === 'Owner' && groupId !== SYSTEM_GROUPS.OWNER) {
    // Eğer başka Owner yoksa engelle
    const { rows: ownerCount } = await query(
      `SELECT COUNT(*)::int AS n FROM users WHERE role = 'Owner' AND status = 'Active'`
    );
    if (ownerCount[0].n <= 1) {
      throw HttpError.conflict('Cannot change permission group of the last Owner');
    }
  }

  await query('UPDATE users SET permission_group_id = $2 WHERE id = $1', [userId, groupId]);

  return {
    uid: target.id,
    email: target.email,
    username: target.username,
    permissionGroupId: groupId,
  };
}

/**
 * Kullanıcının custom_constraints'ini güncelle.
 */
async function setUserCustomConstraints(userId, constraints, actor) {
  const { rows: users } = await query(
    'SELECT id, role, email, username FROM users WHERE id = $1',
    [userId]
  );
  if (!users[0]) throw HttpError.notFound('User not found');

  const validConstraints = {};
  if (constraints) {
    for (const [key, value] of Object.entries(constraints)) {
      if (CONSTRAINT_TYPES.includes(key)) {
        validConstraints[key] = value;
      }
    }
  }

  const cv = Object.keys(validConstraints).length > 0 ? JSON.stringify(validConstraints) : null;

  await query(
    'UPDATE users SET custom_constraints = $2 WHERE id = $1',
    [userId, cv]
  );

  return {
    uid: users[0].id,
    customConstraints: validConstraints,
  };
}

/**
 * Kullanıcının mevcut izinlerini döndür (frontend için).
 */
async function getUserPermissions(user) {
  if (!user) return [];

  if (isOwner(user)) {
    return RESOURCES.flatMap(r =>
      ACTIONS.map(a => ({ resource: r, action: a, allowed: true }))
    );
  }

  const groupId = user.permissionGroupId;
  if (!groupId) {
    // Rol bazlı fallback
    return generateFallbackPermissions(user);
  }

  const { rows } = await query(
    `SELECT resource, action, constraint_type, constraint_value
     FROM permission_entries
     WHERE group_id = $1`,
    [groupId]
  );

  return rows.map(r => ({
    resource: r.resource,
    action: r.action,
    allowed: true,
    constraintType: r.constraint_type,
    constraintValue: r.constraint_value,
  }));
}

function generateFallbackPermissions(user) {
  const perms = [];
  for (const resource of RESOURCES) {
    for (const action of ACTIONS) {
      perms.push({
        resource,
        action,
        allowed: checkRoleFallback(user, resource, action),
      });
    }
  }
  return perms;
}

function isSystemGroup(groupId) {
  return Object.values(SYSTEM_GROUPS).includes(groupId);
}

/**
 * Department (or other list) scope for a resource+action.
 * Returns:
 *   null  → unrestricted (Owner, unconstrained grant, or no group)
 *   []    → no matching grant / empty scope (caller should return empty list)
 *   ['IT', 'Finance'] → restrict SQL to these values
 */
async function getConstraintScope(user, resource, action, constraintType = 'department') {
  if (!user) return [];
  if (isOwner(user)) return null;
  const groupId = user.permissionGroupId;
  if (!groupId) return null; // role-fallback users: no extra filter

  const { rows: entries } = await query(
    `SELECT constraint_type, constraint_value
     FROM permission_entries
     WHERE group_id = $1 AND resource = $2 AND action = $3`,
    [groupId, resource, action]
  );
  if (!entries.length) return [];
  if (entries.some((e) => !e.constraint_type)) return null;

  const values = [];
  for (const entry of entries) {
    if (entry.constraint_type !== constraintType) continue;
    let raw = entry.constraint_value;
    if (typeof raw === 'string') {
      try { raw = JSON.parse(raw); } catch { /* keep string */ }
    }
    if (Array.isArray(raw)) values.push(...raw.map(String));
    else if (raw != null && raw !== '') values.push(String(raw));
  }
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
}

module.exports = {
  checkPermission,
  checkAllPermissions,
  checkAnyPermission,
  getConstraintScope,
  listPermissionGroups,
  getPermissionGroup,
  createPermissionGroup,
  updatePermissionGroup,
  deletePermissionGroup,
  addPermissionEntry,
  updatePermissionEntry,
  deletePermissionEntry,
  deletePermissionEntriesForAction,
  setUserPermissionGroup,
  setUserCustomConstraints,
  getUserPermissions,
  getIamSchema,
  RESOURCES,
  ACTIONS,
  ACTIONS_BY_RESOURCE,
  CONSTRAINT_TYPES,
  SYSTEM_GROUPS,
  isOwner,
};
