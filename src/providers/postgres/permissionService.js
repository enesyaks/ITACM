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

// NOTE: permission checks are intentionally NOT cached. A verdict depends on the
// per-request `context` (department/location/cost/…), so any userId::resource::action
// cache would return wrong answers for constrained grants (a silent authorization
// bug). `clearPermissionCache` is kept as a no-op so entry-mutation call sites that
// invalidate "the cache" stay valid without reintroducing that trap.
function clearPermissionCache() { /* no-op — see note above */ }

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

    // Numeric limits FAIL CLOSED: if the route did not supply the value to check
    // against, the limit cannot be verified, so deny rather than silently allow.
    // A route that wants to honour one of these MUST pass the matching context
    // (cost / seats / assetCount). cost_limit is wired on asset create/update.
    case 'cost_limit': {
      if (context.cost == null) return false;
      const limit = Number(effectiveConstraints);
      return Number.isFinite(limit) && Number(context.cost) <= limit;
    }

    case 'seats_limit': {
      if (context.seats == null) return false;
      const limit = Number(effectiveConstraints);
      return Number.isFinite(limit) && Number(context.seats) <= limit;
    }

    case 'max_assets': {
      if (context.assetCount == null) return false;
      const limit = Number(effectiveConstraints);
      return Number.isFinite(limit) && Number(context.assetCount) <= limit;
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
      // üzerinde create/update/assign yapabilir. General document:* kapalı; zimmet
      // arşivi handover_document:* ile (delete hariç).
      if (resource === 'document') return false;
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

    case 'HR':
      // HR: request create/read + light dashboard. No inventory/IT surfaces.
      if (resource === 'hr_request' && (action === 'create' || action === 'read')) return true;
      if (resource === 'dashboard' && action === 'read') return true;
      return false;

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
 * A non-Owner may only grant a (resource, action) they themselves hold — this is
 * the core no-privilege-escalation rule for permission-group editing/assignment.
 * Owners (isOwner) may grant anything.
 */
async function assertActorMayGrant(actor, resource, action) {
  if (isOwner(actor)) return;
  const has = await checkPermission(actor, resource, action);
  if (!has) {
    throw HttpError.forbidden(
      `You cannot grant ${resource}:${action} — you do not hold that permission yourself`
    );
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
  // No-privilege-escalation: a non-Owner cannot grant a permission they lack —
  // otherwise they could add a powerful entry to a group (even one already
  // assigned to users) and escalate. Owners bypass.
  await assertActorMayGrant(actor, resource, action);

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
  // No-privilege-escalation: a non-Owner cannot re-point an entry at a permission
  // they lack (would otherwise escalate a group already assigned to users).
  await assertActorMayGrant(actor, resource_, action_);
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

  // Portal accounts are self-service employee logins, confined to /api/me by
  // middleware and denied everything by checkRoleFallback. Handing one a
  // permission group would silently switch the IAM layer on for an untrusted
  // account and leave the path gate as the only thing standing.
  if (target.role === 'Portal') {
    throw HttpError.badRequest(
      'Portal (self-service) accounts cannot be placed in a permission group'
    );
  }

  // Normalize so UUID case (e.g. an upper-cased Owner id) can't slip past the
  // string comparisons below — Postgres treats the uuid type case-insensitively.
  const gid = groupId ? String(groupId).toLowerCase() : groupId;

  if (gid) {
    const { rows: groups } = await query(
      'SELECT id, name FROM permission_groups WHERE id = $1',
      [gid]
    );
    if (!groups[0]) throw HttpError.notFound('Permission group not found');
  }

  // Privilege-escalation guard. The built-in Owner group flips isOwner() to true
  // (a blanket bypass of every permission check) and the Admin group grants full
  // operational + confidential access. A delegated user-manager (user_management:
  // update, but not an Owner) must not be able to hand those out — otherwise they
  // could place their own account in the Owner group and become owner-equivalent.
  if (gid === SYSTEM_GROUPS.OWNER || gid === SYSTEM_GROUPS.ADMIN) {
    if (!actor || actor.role !== 'Owner') {
      throw HttpError.forbidden('Only an Owner can assign the Owner or Admin permission group');
    }
  }
  // Keep owner-equivalence bound to the Owner role: never let a non-Owner account
  // gain full control through the group membership alone.
  if (gid === SYSTEM_GROUPS.OWNER && target.role !== 'Owner') {
    throw HttpError.badRequest('Assign the Owner role before placing a user in the Owner permission group');
  }

  // No-privilege-escalation: a non-Owner actor may only place a user into a group
  // whose permissions are a SUBSET of what the actor themselves holds. Otherwise a
  // delegated user-manager (or an Admin) could grant — to their own or another
  // account — a permission they lack (contract:view_confidential, user_management:
  // delete, …), whether the group was hand-crafted or pre-existing. Owners bypass.
  if (gid && !isOwner(actor)) {
    const { rows: grantEntries } = await query(
      'SELECT DISTINCT resource, action FROM permission_entries WHERE group_id = $1',
      [gid]
    );
    for (const e of grantEntries) {
      // eslint-disable-next-line no-await-in-loop
      const actorHas = await checkPermission(actor, e.resource, e.action);
      if (!actorHas) {
        throw HttpError.forbidden(
          `You cannot assign a group that grants ${e.resource}:${e.action} — you do not hold that permission yourself`
        );
      }
    }
  }

  // Owner rolündeki bir kullanıcıyı başka bir gruba atamaya çalışıyorsa engelle
  if (target.role === 'Owner' && gid !== SYSTEM_GROUPS.OWNER) {
    // Eğer başka Owner yoksa engelle
    const { rows: ownerCount } = await query(
      `SELECT COUNT(*)::int AS n FROM users WHERE role = 'Owner' AND status = 'Active'`
    );
    if (ownerCount[0].n <= 1) {
      throw HttpError.conflict('Cannot change permission group of the last Owner');
    }
  }

  await query('UPDATE users SET permission_group_id = $2 WHERE id = $1', [userId, gid]);

  return {
    uid: target.id,
    email: target.email,
    username: target.username,
    permissionGroupId: gid,
  };
}

// Array-type (list-scope) constraints. custom_constraints WIDEN a group's scope
// for these, so handing them out is a grant and must respect no-escalation.
const LIST_CONSTRAINT_TYPES = Object.freeze(['department', 'location', 'category']);

/**
 * No-privilege-escalation for custom_constraints: because mergeConstraints UNIONs
 * list constraints (widening the target's data scope), a non-Owner actor must not
 * assign list values beyond their OWN effective scope. Otherwise a department-
 * restricted user-manager could widen their own (or anyone's) access to other
 * departments/locations/categories. Owners, and actors not themselves restricted
 * on a given dimension, may grant freely on that dimension.
 */
async function assertMayWidenConstraints(actor, constraints) {
  if (isOwner(actor)) return;
  if (!actor || !actor.permissionGroupId) return; // role-fallback actors carry no list constraints

  const want = {};
  for (const k of LIST_CONSTRAINT_TYPES) {
    const v = constraints && constraints[k];
    if (Array.isArray(v) && v.length) want[k] = v.map((x) => String(x).trim().toLowerCase());
  }
  if (!Object.keys(want).length) return; // nothing list-scoped is being granted

  const { rows } = await query(
    `SELECT constraint_type, constraint_value FROM permission_entries
     WHERE group_id = $1 AND constraint_type = ANY($2::text[])`,
    [actor.permissionGroupId, LIST_CONSTRAINT_TYPES]
  );
  const own = { department: new Set(), location: new Set(), category: new Set() };
  const restricted = { department: false, location: false, category: false };
  for (const r of rows) {
    restricted[r.constraint_type] = true;
    let raw = r.constraint_value;
    if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch { /* keep */ } }
    const list = Array.isArray(raw) ? raw : (raw != null ? [raw] : []);
    for (const val of list) own[r.constraint_type].add(String(val).trim().toLowerCase());
  }
  // The actor's own custom_constraints are scope they already effectively hold.
  const ac = (actor.customConstraints && typeof actor.customConstraints === 'object') ? actor.customConstraints : {};
  for (const k of LIST_CONSTRAINT_TYPES) {
    if (Array.isArray(ac[k])) for (const val of ac[k]) own[k].add(String(val).trim().toLowerCase());
  }

  for (const [k, vals] of Object.entries(want)) {
    if (!restricted[k]) continue; // actor is unrestricted on this dimension → may grant any
    for (const val of vals) {
      if (!own[k].has(val)) {
        throw HttpError.forbidden(
          `You cannot grant ${k} "${val}" — it is outside your own scope`
        );
      }
    }
  }
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

  // No-privilege-escalation: a non-Owner may not widen scope beyond their own.
  await assertMayWidenConstraints(actor, validConstraints);

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
  // Exported so the role matrix — the fallback every user without a custom IAM
  // group is judged by — can be unit-tested without a database.
  checkRoleFallback,
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
