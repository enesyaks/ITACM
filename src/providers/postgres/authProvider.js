/**
 * Local auth provider (postgres mode) — Email/Password + optional TOTP MFA.
 *
 * Login with MFA returns a short-lived mfaToken; POST /auth/mfa/verify
 * exchanges it for a session JWT (jti-tracked for logout revoke).
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { authenticator } = require('otplib');
const QRCode = require('qrcode');
const { query, withTransaction } = require('./pool');
const config = require('../../config');
const { HttpError } = require('../../utils/httpError');
const { ROLES, buildPermissions } = require('../../utils/permissions');
const { roleRequiresMfa } = require('../../utils/mfaPolicy');

authenticator.options = { window: 1 };

function assertValidRole(role) {
  if (!ROLES.includes(role)) {
    throw HttpError.badRequest(`Invalid role "${role}". Must be one of: ${ROLES.join(', ')}`);
  }
}

function assertPasswordPolicy(password) {
  if (!password || password.length < 8) {
    throw HttpError.badRequest('Password must be at least 8 characters');
  }
}

const DUMMY_HASH = bcrypt.hashSync('itacm-timing-equalizer', 12);

function parseExpiryToDate(expiresIn) {
  const m = String(expiresIn || '12h').match(/^(\d+)([smhd])$/i);
  if (!m) return new Date(Date.now() + 12 * 3600 * 1000);
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  const mult = unit === 's' ? 1000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;
  return new Date(Date.now() + n * mult);
}

async function issueSession(user, meta = {}) {
  const jti = crypto.randomUUID();
  const token = jwt.sign(
    { sub: user.id, email: user.email, role: user.role, jti },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn, issuer: 'itacm', algorithm: 'HS256' }
  );

  await query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
  await query(
    'INSERT INTO login_logs (user_id, email, ip, user_agent) VALUES ($1, $2, $3, $4)',
    [user.id, user.email, meta.ip || null, meta.userAgent || null]
  );

  return {
    token,
    expiresIn: config.jwtExpiresIn,
    user: {
      uid: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      mfaEnabled: !!user.mfa_enabled,
      mustChangePassword: !!user.must_change_password,
    },
    ...(roleRequiresMfa(user.role) && !user.mfa_enabled
      ? { mfaEnrollmentRequired: true }
      : {}),
    ...(user.must_change_password ? { mustChangePassword: true } : {}),
  };
}

function issueMfaChallenge(user) {
  const jti = crypto.randomUUID();
  const mfaToken = jwt.sign(
    { sub: user.id, purpose: 'mfa', email: user.email, jti },
    config.jwtSecret,
    { expiresIn: '5m', issuer: 'itacm', algorithm: 'HS256' }
  );
  return {
    mfaRequired: true,
    mfaToken,
    expiresIn: '5m',
    user: { email: user.email, username: user.username },
  };
}

async function denylistJti(jti, expiresAt) {
  if (!jti || !expiresAt) return;
  await query(
    `INSERT INTO jwt_denylist (jti, expires_at) VALUES ($1, $2)
     ON CONFLICT (jti) DO NOTHING`,
    [jti, expiresAt]
  );
}

async function assertJtiNotDenied(jti) {
  if (!jti) return;
  const { rows: denied } = await query(
    'SELECT 1 FROM jwt_denylist WHERE jti = $1 AND expires_at > now()',
    [jti]
  );
  if (denied[0]) throw HttpError.unauthorized('Session revoked — sign in again');
}

async function verifyMfaChallengeToken(mfaToken) {
  let payload;
  try {
    payload = jwt.verify(mfaToken, config.jwtSecret, { issuer: 'itacm', algorithms: ['HS256'] });
  } catch {
    throw HttpError.unauthorized('MFA challenge expired — sign in again');
  }
  if (payload.purpose !== 'mfa' || !payload.sub) {
    throw HttpError.unauthorized('Invalid MFA challenge');
  }
  await assertJtiNotDenied(payload.jti);
  const { rows } = await query('SELECT * FROM users WHERE id = $1', [payload.sub]);
  if (!rows[0]) throw HttpError.unauthorized('Account no longer exists');
  if (rows[0].status === 'Disabled') throw HttpError.forbidden('This account has been disabled');
  await assertPortalEmployeeActive(rows[0]);
  return {
    user: rows[0],
    jti: payload.jti || null,
    tokenExp: payload.exp ? new Date(payload.exp * 1000) : new Date(Date.now() + 5 * 60 * 1000),
  };
}

/**
 * Portal logins are tied to an Active employee record (by email).
 * Inactive / missing employees must never sign in — even if a users row remains.
 */
async function assertPortalEmployeeActive(user) {
  if (!user || user.role !== 'Portal') return;
  const email = String(user.email || '').trim().toLowerCase();
  if (!email) {
    throw HttpError.forbidden('Portal access is no longer available — contact IT');
  }
  const { rows } = await query(
    `SELECT status FROM employees WHERE lower(email) = $1 LIMIT 1`,
    [email]
  );
  if (!rows[0] || rows[0].status !== 'Active') {
    throw HttpError.forbidden('Portal access is no longer available — contact IT');
  }
}

async function login({ email, password }, meta = {}) {
  if (!email || !password) throw HttpError.badRequest('email and password are required');

  const { rows } = await query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
  const user = rows[0];
  const match = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
  const valid = user && match;
  if (!valid) throw HttpError.unauthorized('Invalid email or password');
  if (user.status === 'Disabled') throw HttpError.forbidden('This account has been disabled — contact your Owner');
  await assertPortalEmployeeActive(user);

  if (user.mfa_enabled && user.mfa_secret) {
    return issueMfaChallenge(user);
  }
  return issueSession(user, meta);
}

async function verifyMfaLogin({ mfaToken, code, backupCode }, meta = {}) {
  const { user, jti, tokenExp } = await verifyMfaChallengeToken(mfaToken);
  if (!user.mfa_enabled || !user.mfa_secret) {
    throw HttpError.badRequest('MFA is not enabled for this account');
  }

  const consumeChallenge = async () => {
    // One-time MFA challenge — prevent replay within the 5m TTL / TOTP window.
    await denylistJti(jti, tokenExp);
  };

  const totpOk = code && authenticator.verify({ token: String(code).replace(/\s/g, ''), secret: user.mfa_secret });
  if (totpOk) {
    await consumeChallenge();
    return issueSession(user, meta);
  }

  if (backupCode) {
    const hashes = user.mfa_backup_hashes || [];
    for (let i = 0; i < hashes.length; i++) {
      if (await bcrypt.compare(String(backupCode).trim(), hashes[i])) {
        const next = hashes.slice(0, i).concat(hashes.slice(i + 1));
        await query('UPDATE users SET mfa_backup_hashes = $2 WHERE id = $1', [user.id, next]);
        await consumeChallenge();
        return issueSession(user, meta);
      }
    }
  }

  throw HttpError.unauthorized('Invalid authentication code');
}

async function verifyToken(token) {
  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret, { issuer: 'itacm', algorithms: ['HS256'] });
  } catch (err) {
    throw err.name === 'TokenExpiredError'
      ? HttpError.unauthorized('Token expired — sign in again')
      : HttpError.unauthorized('Invalid token');
  }
  if (payload.purpose === 'mfa') {
    throw HttpError.unauthorized('Complete MFA before accessing the app');
  }
  await assertJtiNotDenied(payload.jti);

  const { rows } = await query(
    'SELECT id, email, role, username, status, mfa_enabled, must_change_password, sessions_revoked_at FROM users WHERE id = $1',
    [payload.sub]
  );
  if (!rows[0]) throw HttpError.unauthorized('Account no longer exists');
  if (rows[0].status === 'Disabled') throw HttpError.unauthorized('This account has been disabled');
  await assertPortalEmployeeActive(rows[0]);

  // Password change (and similar) bumps sessions_revoked_at — invalidate older JWTs.
  const revokedAt = rows[0].sessions_revoked_at;
  if (revokedAt && payload.iat != null) {
    const revokedSec = Math.floor(new Date(revokedAt).getTime() / 1000);
    if (payload.iat <= revokedSec) {
      throw HttpError.unauthorized('Session revoked — sign in again');
    }
  }

  return {
    uid: rows[0].id,
    email: rows[0].email,
    role: rows[0].role,
    username: rows[0].username,
    mfaEnabled: !!rows[0].mfa_enabled,
    mustChangePassword: !!rows[0].must_change_password,
    jti: payload.jti || null,
    tokenExp: payload.exp ? new Date(payload.exp * 1000) : parseExpiryToDate(config.jwtExpiresIn),
  };
}

async function logout(user) {
  if (user && user.jti && user.tokenExp) {
    await denylistJti(user.jti, user.tokenExp);
  }
  // Opportunistic cleanup of expired entries
  await query('DELETE FROM jwt_denylist WHERE expires_at < now() - interval \'1 day\'').catch(() => {});
  return { revoked: true };
}

async function recordLogin() { /* no-op */ }

async function changePassword(user, { currentPassword, newPassword }, meta = {}) {
  if (!currentPassword || !newPassword) {
    throw HttpError.badRequest('currentPassword and newPassword are required');
  }
  assertPasswordPolicy(newPassword);
  const { rows } = await query('SELECT * FROM users WHERE id = $1', [user.uid]);
  if (!rows[0]) throw HttpError.unauthorized();
  const ok = await bcrypt.compare(currentPassword, rows[0].password_hash);
  if (!ok) throw HttpError.unauthorized('Current password is incorrect');
  // Temp/one-time passwords must be replaced with a different value.
  if (await bcrypt.compare(newPassword, rows[0].password_hash)) {
    throw HttpError.badRequest('New password must be different from the current password');
  }
  const hash = await bcrypt.hash(newPassword, 12);
  // Revoke every existing session (iat ≤ sessions_revoked_at). Subtract 1s so the
  // freshly issued JWT below is not rejected when iat lands in the same second.
  await query(
    `UPDATE users
       SET password_hash = $2, must_change_password = false,
           sessions_revoked_at = now() - interval '1 second'
     WHERE id = $1`,
    [user.uid, hash]
  );
  if (user.jti && user.tokenExp) await denylistJti(user.jti, user.tokenExp);
  const { rows: updated } = await query('SELECT * FROM users WHERE id = $1', [user.uid]);
  const session = await issueSession(updated[0], meta);
  return { changed: true, reauthRequired: false, ...session };
}

function companyIssuer() {
  return 'ITACM';
}

async function mfaSetupStart(user) {
  const secret = authenticator.generateSecret();
  await query('UPDATE users SET mfa_pending_secret = $2 WHERE id = $1', [user.uid, secret]);
  const otpauth = authenticator.keyuri(user.email || user.uid, companyIssuer(), secret);
  const qrDataUrl = await QRCode.toDataURL(otpauth, { margin: 1, width: 200 });
  return { secret, otpauth, qrDataUrl };
}

function generateBackupCodes(n = 8) {
  const codes = [];
  for (let i = 0; i < n; i++) {
    codes.push(crypto.randomBytes(16).toString('base64url'));
  }
  return codes;
}

async function mfaSetupConfirm(user, { code }) {
  const { rows } = await query(
    'SELECT mfa_pending_secret, mfa_enabled FROM users WHERE id = $1',
    [user.uid]
  );
  const pending = rows[0]?.mfa_pending_secret;
  if (!pending) throw HttpError.badRequest('No MFA setup in progress — start setup again');
  const clean = String(code || '').replace(/\s/g, '');
  if (!authenticator.verify({ token: clean, secret: pending })) {
    throw HttpError.badRequest('Invalid code — check your authenticator app');
  }
  const backups = generateBackupCodes();
  const hashes = await Promise.all(backups.map((c) => bcrypt.hash(c, 10)));
  await query(
    `UPDATE users
     SET mfa_secret = $2, mfa_enabled = true, mfa_pending_secret = NULL, mfa_backup_hashes = $3
     WHERE id = $1`,
    [user.uid, pending, hashes]
  );
  return { enabled: true, backupCodes: backups };
}

async function mfaDisable(user, { password, code }) {
  if (roleRequiresMfa(user.role)) {
    throw HttpError.forbidden('MFA is mandatory for Owner accounts and cannot be disabled');
  }
  const { rows } = await query(
    'SELECT password_hash, mfa_secret, mfa_enabled FROM users WHERE id = $1',
    [user.uid]
  );
  const row = rows[0];
  if (!row) throw HttpError.unauthorized();
  if (!row.mfa_enabled) return { enabled: false };
  const pwdOk = await bcrypt.compare(password || '', row.password_hash);
  if (!pwdOk) throw HttpError.unauthorized('Password is incorrect');
  const totpOk = code && authenticator.verify({
    token: String(code).replace(/\s/g, ''),
    secret: row.mfa_secret,
  });
  if (!totpOk) throw HttpError.unauthorized('Invalid authentication code');
  await query(
    `UPDATE users
     SET mfa_enabled = false, mfa_secret = NULL, mfa_pending_secret = NULL, mfa_backup_hashes = '{}'
     WHERE id = $1`,
    [user.uid]
  );
  return { enabled: false };
}

async function mfaStatus(user) {
  const { rows } = await query(
    'SELECT mfa_enabled, cardinality(mfa_backup_hashes) AS backup_left FROM users WHERE id = $1',
    [user.uid]
  );
  const enabled = !!rows[0]?.mfa_enabled;
  return {
    enabled,
    backupCodesRemaining: Number(rows[0]?.backup_left || 0),
    mandatory: roleRequiresMfa(user.role),
    enrollmentRequired: roleRequiresMfa(user.role) && !enabled,
  };
}

async function getLoginLogs(uid, limit = 25) {
  const { rows } = await query(
    `SELECT id, email, ip, user_agent AS "userAgent", "timestamp"
     FROM login_logs WHERE user_id = $1 ORDER BY "timestamp" DESC LIMIT $2`,
    [uid, Math.min(Number(limit) || 25, 100)]
  );
  return rows;
}

async function createItUser({ username, email, password, role }, actor) {
  if (!username || !email || !password) {
    throw HttpError.badRequest('username, email and password are required');
  }
  assertPasswordPolicy(password);
  assertValidRole(role);
  if (role === 'Portal') {
    throw HttpError.badRequest('createItUser cannot create Portal accounts');
  }
  if ((role === 'Owner' || role === 'Admin') && actor && actor.role !== 'Owner') {
    throw HttpError.forbidden('Only an Owner can assign the Owner or Admin role');
  }

  const hash = await bcrypt.hash(password, 12);
  try {
    const { rows } = await query(
      `INSERT INTO users (username, email, password_hash, role)
       VALUES ($1, $2, $3, $4) RETURNING id, username, email, role`,
      [username, email.toLowerCase(), hash, role]
    );
    const u = rows[0];
    try {
      const { ensureEmployeeForEmail } = require('./employeeService');
      await ensureEmployeeForEmail({
        fullName: username,
        email: u.email,
        department: 'IT',
        title: role,
      });
    } catch (twinErr) {
      console.warn('[createItUser] employee twin failed:', twinErr.message);
    }
    return { uid: u.id, username: u.username, email: u.email, role: u.role };
  } catch (err) {
    if (err.code === '23505') throw HttpError.conflict(`A user with email ${email} already exists`);
    throw err;
  }
}

async function upsertAdmin({ username, email, password }) {
  return upsertAdminTx(null, { username, email, password });
}

async function upsertAdminTx(client, { username, email, password }) {
  if (!username || !email || !password) {
    throw HttpError.badRequest('username, email and password are required');
  }
  assertPasswordPolicy(password);

  const hash = await bcrypt.hash(password, 12);
  const q = client ? client.query.bind(client) : query;
  const { rows } = await q(
    `INSERT INTO users (username, email, password_hash, role)
     VALUES ($1, $2, $3, 'Owner')
     ON CONFLICT (email) DO UPDATE
       SET username = EXCLUDED.username, password_hash = EXCLUDED.password_hash, role = 'Owner'
     RETURNING id, username, email, role`,
    [username, email.toLowerCase(), hash]
  );
  const u = rows[0];
  try {
    const { ensureEmployeeForEmail } = require('./employeeService');
    await ensureEmployeeForEmail({
      fullName: username,
      email: u.email,
      department: 'IT',
      title: 'Owner',
    });
  } catch (twinErr) {
    console.warn('[upsertAdminTx] employee twin failed:', twinErr.message);
  }
  return { uid: u.id, username: u.username, email: u.email, role: u.role };
}

async function setUserRole(uid, role, actor) {
  assertValidRole(role);
  const { rows: existing } = await query(
    'SELECT id, role, email, username, mfa_enabled FROM users WHERE id = $1',
    [uid]
  );
  if (!existing[0]) throw HttpError.notFound(`No user with id ${uid}`);
  if (existing[0].role === 'Owner' && (!actor || actor.role !== 'Owner')) {
    throw HttpError.forbidden('Only an Owner can change another Owner\'s role');
  }
  if ((role === 'Owner' || role === 'Admin') && (!actor || actor.role !== 'Owner')) {
    throw HttpError.forbidden('Only an Owner can assign the Owner or Admin role');
  }
  if (role === 'Owner' && !existing[0].mfa_enabled) {
    throw HttpError.badRequest('Enable MFA on this account before assigning the Owner role');
  }
  const { rows } = await query(
    'UPDATE users SET role = $2 WHERE id = $1 RETURNING id, role, email, username',
    [uid, role]
  );
  if (actor) await logAdminAction(rows[0], 'role_changed', actor.username || actor.email, `→ ${role}`);
  return { uid, role };
}

async function getVerifiedProfile(user) {
  const { rows } = await query(
    `SELECT username, mfa_enabled, must_change_password,
            permission_group_id AS "permissionGroupId",
            custom_constraints AS "customConstraints"
     FROM users WHERE id = $1`,
    [user.uid]
  );
  const row = rows[0];
  const enriched = {
    ...user,
    permissionGroupId: row?.permissionGroupId || user.permissionGroupId || null,
    customConstraints: row?.customConstraints || user.customConstraints || null,
  };

  let iamPermissions = [];
  try {
    const permissionService = require('./permissionService');
    iamPermissions = await permissionService.getUserPermissions(enriched);
  } catch { /* ignore if permission service not available */ }

  return {
    uid: enriched.uid,
    email: enriched.email,
    username: row?.username || enriched.email,
    role: enriched.role,
    mfaEnabled: !!row?.mfa_enabled,
    mfaMandatory: roleRequiresMfa(enriched.role),
    mfaEnrollmentRequired: roleRequiresMfa(enriched.role) && !row?.mfa_enabled,
    mustChangePassword: !!row?.must_change_password,
    permissionGroupId: enriched.permissionGroupId,
    customConstraints: enriched.customConstraints,
    permissions: uiPermissionsFromIam(iamPermissions, enriched.role),
    iamPermissions,
  };
}

/** Map IAM entries → legacy Auth.can() flags used by the SPA. */
function uiPermissionsFromIam(iamPermissions, role) {
  const legacy = buildPermissions(role);
  if (role === 'Owner') return legacy;

  const list = Array.isArray(iamPermissions) ? iamPermissions : [];
  const has = (resource, action) =>
    list.some((p) => p.resource === resource && p.action === action && p.allowed !== false);

  return {
    ...legacy,
    canViewDashboard: has('dashboard', 'read') || legacy.canViewDashboard,
    // manage = full ops; create/update stay granular; listing needs read (or manage/assign/unassign)
    canManageAssets: has('asset', 'manage') || has('asset', 'create') || has('asset', 'update'),
    canCreateAssets: has('asset', 'create'),
    canUpdateAssets: has('asset', 'manage') || has('asset', 'update'),
    canAssignAssets: has('asset', 'manage') || has('asset', 'assign'),
    canUnassignAssets: has('asset', 'manage') || has('asset', 'unassign'),
    canListAssets:
      has('asset', 'read')
      || has('asset', 'manage')
      || has('asset', 'assign')
      || has('asset', 'unassign'),
    // Scoped views when inventory is not fully opened by read/manage
    assetUnassignScopeOnly:
      has('asset', 'unassign')
      && !has('asset', 'assign')
      && !has('asset', 'manage')
      && !has('asset', 'read'),
    assetAssignScopeOnly:
      has('asset', 'assign')
      && !has('asset', 'unassign')
      && !has('asset', 'manage')
      && !has('asset', 'read'),
    assetAssignUnassignScopeOnly:
      has('asset', 'assign')
      && has('asset', 'unassign')
      && !has('asset', 'manage')
      && !has('asset', 'read'),
    canExecuteHandovers: has('handover', 'create'),
    canManageMaintenance: has('maintenance', 'create') || has('maintenance', 'update'),
    canManageUsers:
      has('user_management', 'read')
      || has('user_management', 'create')
      || has('user_management', 'update'),
    canViewAudit: has('audit', 'read'),
    canViewConfidentialContracts: has('contract', 'view_confidential'),
    // Financial amounts (masraf / fatura tutarı / sözleşme bedeli)
    canViewContractCosts: has('contract', 'view_confidential'),
    canViewLineCosts: has('line', 'view_confidential'),
    canViewLicenseCosts: has('license', 'view_confidential'),
    canViewMaintenanceCosts: has('maintenance', 'view_confidential'),
    // Invoices / PDFs
    canReadDocuments: has('document', 'read'),
    canDownloadDocuments: has('document', 'download'),
    canUploadDocuments: has('document', 'upload') || has('document', 'create'),
    canDeleteDocuments: has('document', 'delete'),
    canManageBranding: has('settings', 'manage'),
    canManageOwner: role === 'Owner',
    isOwner: role === 'Owner',
    canAccessIntegrations:
      has('integration', 'read')
      || has('integration', 'update')
      || has('integration', 'manage'),
    // export/import are explicit IAM toggles — manage does not imply them
    canExportAssets: has('asset', 'export'),
    canExportNetwork: has('asset', 'export') || has('report', 'export'),
    canExportReports: has('report', 'export'),
    canImportAssets: has('asset', 'import'),
  };
}

async function listUsers() {
  const { rows } = await query(
    `SELECT u.id AS uid, u.username, u.email, u.role, u.status, u.mfa_enabled AS "mfaEnabled",
            u.created_at AS "createdAt", u.last_login_at AS "lastLoginAt",
            u.permission_group_id AS "permissionGroupId",
            pg.name AS "permissionGroupName"
     FROM users u
     LEFT JOIN permission_groups pg ON u.permission_group_id = pg.id
     ORDER BY u.created_at DESC`
  );
  return rows;
}

const logAdminAction = (target, action, byName, detail = null) => query(
  'INSERT INTO user_admin_logs (target_email, target_name, action, detail, by_name) VALUES ($1,$2,$3,$4,$5)',
  [target.email, target.username || null, action, detail, byName]
);

async function getTargetUser(uid, actor) {
  const { rows } = await query('SELECT id, email, username, role, status FROM users WHERE id = $1', [uid]);
  if (!rows[0]) throw HttpError.notFound(`No user with id ${uid}`);
  if (rows[0].id === actor.uid) throw HttpError.badRequest('You cannot disable or delete your own account');
  return rows[0];
}

async function setUserStatus(uid, status, actor) {
  if (!['Active', 'Disabled'].includes(status)) throw HttpError.badRequest('status must be Active or Disabled');
  const target = await getTargetUser(uid, actor);
  if (target.role === 'Owner' && status === 'Disabled') {
    const { rows } = await query(`SELECT COUNT(*)::int AS n FROM users WHERE role = 'Owner' AND status = 'Active'`);
    if (rows[0].n <= 1) throw HttpError.conflict('Cannot disable the last active Owner');
  }
  await query('UPDATE users SET status = $2 WHERE id = $1', [uid, status]);
  await logAdminAction(target, status === 'Disabled' ? 'disabled' : 'enabled', actor.username || actor.email);
  return { uid, status };
}

async function deleteUser(uid, actor) {
  const target = await getTargetUser(uid, actor);
  if (target.role === 'Owner') {
    const { rows } = await query(`SELECT COUNT(*)::int AS n FROM users WHERE role = 'Owner'`);
    if (rows[0].n <= 1) throw HttpError.conflict('Cannot delete the last Owner');
  }
  await query('DELETE FROM users WHERE id = $1', [uid]);
  await logAdminAction(target, 'deleted', actor.username || actor.email, `role was ${target.role}`);
  return { uid, deleted: true };
}

/**
 * Owner hand-off. Prefer promoting an existing Active non-Owner user (must have MFA);
 * otherwise create a new Owner account. Either way the caller is demoted to Admin in
 * one transaction after verifying their TOTP as a step-up.
 *
 * Create path: `password` is the new Owner's initial password (server-generated temp
 * when SMTP is on, or Owner-supplied when off). New Owners are force-prompted to
 * enrol MFA on first login (roleRequiresMfa).
 */
async function assertOwnerTransferActor(actor, code) {
  const { rows: mine } = await query(
    'SELECT id, email, username, role, mfa_enabled, mfa_secret FROM users WHERE id = $1',
    [actor.uid]
  );
  const me = mine[0];
  if (!me || me.role !== 'Owner') throw HttpError.forbidden('Only an Owner can transfer ownership');
  if (!me.mfa_enabled || !me.mfa_secret) {
    throw HttpError.badRequest('Enable MFA on your account before transferring ownership');
  }
  const codeOk = code && authenticator.verify({ token: String(code).replace(/\s/g, ''), secret: me.mfa_secret });
  if (!codeOk) throw HttpError.unauthorized('Invalid MFA code');
  return me;
}

async function demoteCallerAndLog(t, me, newOwner, detailGranted) {
  await t.query(
    `UPDATE users SET role = 'Admin', sessions_revoked_at = now() WHERE id = $1`,
    [me.id]
  );
  await t.query(
    'INSERT INTO user_admin_logs (target_email, target_name, action, detail, by_name) VALUES ($1,$2,$3,$4,$5)',
    [newOwner.email, newOwner.username, 'ownership_granted', detailGranted, me.username || me.email]
  );
  await t.query(
    'INSERT INTO user_admin_logs (target_email, target_name, action, detail, by_name) VALUES ($1,$2,$3,$4,$5)',
    [me.email, me.username, 'ownership_transferred', `to ${newOwner.email}; Owner -> Admin`, me.username || me.email]
  );
}

async function transferOwnership({ targetUserId, email, username, password, code }, actor) {
  const me = await assertOwnerTransferActor(actor, code);

  if (targetUserId) {
    const newOwner = await withTransaction(async (t) => {
      const { rows } = await t.query(
        `SELECT id, username, email, role, status, mfa_enabled
         FROM users WHERE id = $1 FOR UPDATE`,
        [targetUserId]
      );
      const target = rows[0];
      if (!target) throw HttpError.notFound(`No user with id ${targetUserId}`);
      if (target.id === me.id) throw HttpError.badRequest('The new owner must be a different account');
      if (target.role === 'Owner') throw HttpError.badRequest('That user is already an Owner');
      if (target.status !== 'Active') throw HttpError.badRequest('The new owner must be an Active user');
      if (!target.mfa_enabled) {
        throw HttpError.badRequest('The selected user must have MFA enabled before becoming Owner');
      }
      await t.query(`UPDATE users SET role = 'Owner' WHERE id = $1`, [target.id]);
      const promoted = { uid: target.id, username: target.username, email: target.email, role: 'Owner' };
      await demoteCallerAndLog(
        t, me, promoted,
        `existing user promoted to Owner; ${me.email} stepped down to Admin`
      );
      return promoted;
    });
    return { newOwner, mode: 'existing' };
  }

  if (!username || !email) throw HttpError.badRequest('New owner name and email are required');
  const normEmail = String(email).toLowerCase().trim();
  if (normEmail === String(me.email).toLowerCase()) {
    throw HttpError.badRequest('The new owner must be a different account');
  }
  assertPasswordPolicy(password);
  const hash = await bcrypt.hash(password, 12);

  const newOwner = await withTransaction(async (t) => {
    let created;
    try {
      const { rows } = await t.query(
        `INSERT INTO users (username, email, password_hash, role)
         VALUES ($1, $2, $3, 'Owner') RETURNING id, username, email, role`,
        [username, normEmail, hash]
      );
      created = rows[0];
    } catch (err) {
      if (err.code === '23505') throw HttpError.conflict(`A user with email ${normEmail} already exists`);
      throw err;
    }
    const createdOwner = { uid: created.id, username: created.username, email: created.email, role: created.role };
    await demoteCallerAndLog(
      t, me, createdOwner,
      `new Owner; ${me.email} stepped down to Admin`
    );
    return createdOwner;
  });
  return { newOwner, mode: 'create' };
}

/** Preflight for the owner-transfer UI: MFA status plus Active non-Owner candidates. */
async function ownerTransferPreflight(actor) {
  const { rows: mine } = await query('SELECT mfa_enabled FROM users WHERE id = $1', [actor.uid]);
  const { rows: candidates } = await query(
    `SELECT id AS uid, username, email, role, mfa_enabled AS "mfaEnabled"
     FROM users
     WHERE status = 'Active' AND role <> 'Owner' AND id <> $1
     ORDER BY username ASC NULLS LAST, email ASC`,
    [actor.uid]
  );
  return { mfaEnrolled: !!(mine[0] && mine[0].mfa_enabled), candidates };
}

/**
 * Grant (or re-provision) a self-service Portal login for an employee, keyed by
 * the employee's email. Returns a fresh temporary password the caller can email
 * or hand over. Never touches a non-Portal (staff) account that happens to share
 * the email — those are refused so a directory action can't reset a real login.
 */
async function grantPortalAccess({ employee }, actor) {
  const email = String((employee && employee.email) || '').trim().toLowerCase();
  const name = (employee && (employee.fullName || employee.full_name)) || email;
  const status = (employee && employee.status) || '';
  if (!email) {
    throw HttpError.badRequest('This employee has no email — add one before granting web access');
  }
  if (status !== 'Active') {
    throw HttpError.badRequest('Cannot grant web access to an inactive (offboarded) employee');
  }
  const tempPassword = crypto.randomBytes(12).toString('base64url');
  const hash = await bcrypt.hash(tempPassword, 12);

  const { rows: existing } = await query(
    'SELECT id, role FROM users WHERE lower(email) = $1',
    [email]
  );

  let userRow;
  let created;
  if (existing[0]) {
    if (existing[0].role !== 'Portal') {
      throw HttpError.conflict(
        'A staff account already uses this email — it cannot be turned into a portal login'
      );
    }
    // Re-provision: reset the temp password, force change on next login, revoke old sessions.
    const { rows } = await query(
      `UPDATE users
         SET password_hash = $2, status = 'Active', must_change_password = true,
             sessions_revoked_at = now()
       WHERE id = $1
       RETURNING id, username, email, role`,
      [existing[0].id, hash]
    );
    userRow = rows[0];
    created = false;
  } else {
    const { rows } = await query(
      `INSERT INTO users (username, email, password_hash, role, must_change_password)
       VALUES ($1, $2, $3, 'Portal', true)
       RETURNING id, username, email, role`,
      [name, email, hash]
    );
    userRow = rows[0];
    created = true;
  }

  if (actor) {
    await logAdminAction(
      { email: userRow.email, username: userRow.username },
      created ? 'portal_access_granted' : 'portal_access_reset',
      actor.username || actor.email
    );
  }

  return {
    user: { uid: userRow.id, username: userRow.username, email: userRow.email, role: userRow.role },
    tempPassword,
    created,
  };
}

/**
 * Revoke self-service Portal login for an employee: invalidate sessions then
 * delete the Portal user. Staff accounts (non-Portal) are not touched.
 */
/**
 * @param {{ soft?: boolean }} [opts] — soft: no throw when there is nothing to revoke
 *   (used by offboard / Inactive status updates).
 */
async function revokePortalAccess({ employee }, actor, opts = {}) {
  const soft = !!(opts && opts.soft);
  const email = String((employee && employee.email) || '').trim().toLowerCase();
  if (!email) {
    if (soft) return { revoked: false };
    throw HttpError.badRequest('This employee has no email — cannot revoke web access');
  }

  const { rows } = await query(
    'SELECT id, email, username, role, status FROM users WHERE lower(email) = $1',
    [email]
  );
  if (!rows[0]) {
    if (soft) return { revoked: false };
    throw HttpError.notFound('No portal access for this employee');
  }
  if (rows[0].role !== 'Portal') {
    if (soft) return { revoked: false };
    throw HttpError.conflict(
      'This email belongs to a staff account — revoke from IT Users instead'
    );
  }

  const target = rows[0];
  await query(
    `UPDATE users SET sessions_revoked_at = now() WHERE id = $1 AND role = 'Portal'`,
    [target.id]
  );
  await query(`DELETE FROM users WHERE id = $1 AND role = 'Portal'`, [target.id]);

  if (actor) {
    await logAdminAction(
      { email: target.email, username: target.username },
      'portal_access_revoked',
      actor.username || actor.email
    );
  }

  return {
    revoked: true,
    user: { uid: target.id, email: target.email, username: target.username },
  };
}

async function getAdminLogs(email, limit = 25) {
  const { rows } = await query(
    `SELECT target_email AS "targetEmail", target_name AS "targetName", action, detail,
            by_name AS "byName", "timestamp"
     FROM user_admin_logs WHERE target_email = $1 ORDER BY "timestamp" DESC LIMIT $2`,
    [email, Math.min(Number(limit) || 25, 200)]
  );
  return rows;
}

module.exports = {
  login, verifyMfaLogin, verifyToken, logout, recordLogin, getLoginLogs,
  changePassword, mfaSetupStart, mfaSetupConfirm, mfaDisable, mfaStatus,
  createItUser, upsertAdmin, upsertAdminTx, setUserRole, getVerifiedProfile, listUsers,
  setUserStatus, deleteUser, getAdminLogs,
  transferOwnership, ownerTransferPreflight,
  grantPortalAccess, revokePortalAccess,
};
