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
const { query } = require('./pool');
const config = require('../../config');
const { HttpError } = require('../../utils/httpError');
const { ROLES, buildPermissions } = require('../../utils/permissions');

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
    },
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
  return {
    user: rows[0],
    jti: payload.jti || null,
    tokenExp: payload.exp ? new Date(payload.exp * 1000) : new Date(Date.now() + 5 * 60 * 1000),
  };
}

async function login({ email, password }, meta = {}) {
  if (!email || !password) throw HttpError.badRequest('email and password are required');

  const { rows } = await query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
  const user = rows[0];
  const match = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
  const valid = user && match;
  if (!valid) throw HttpError.unauthorized('Invalid email or password');
  if (user.status === 'Disabled') throw HttpError.forbidden('This account has been disabled — contact your Owner');

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
    'SELECT id, email, role, username, status, mfa_enabled, sessions_revoked_at FROM users WHERE id = $1',
    [payload.sub]
  );
  if (!rows[0]) throw HttpError.unauthorized('Account no longer exists');
  if (rows[0].status === 'Disabled') throw HttpError.unauthorized('This account has been disabled');

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

async function changePassword(user, { currentPassword, newPassword }) {
  if (!currentPassword || !newPassword) {
    throw HttpError.badRequest('currentPassword and newPassword are required');
  }
  assertPasswordPolicy(newPassword);
  const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [user.uid]);
  if (!rows[0]) throw HttpError.unauthorized();
  const ok = await bcrypt.compare(currentPassword, rows[0].password_hash);
  if (!ok) throw HttpError.unauthorized('Current password is incorrect');
  const hash = await bcrypt.hash(newPassword, 12);
  // Revoke every existing session for this user (iat ≤ sessions_revoked_at).
  await query(
    'UPDATE users SET password_hash = $2, sessions_revoked_at = now() WHERE id = $1',
    [user.uid, hash]
  );
  if (user.jti && user.tokenExp) await denylistJti(user.jti, user.tokenExp);
  return { changed: true, reauthRequired: true };
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
    codes.push(crypto.randomBytes(4).toString('hex'));
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
  return {
    enabled: !!rows[0]?.mfa_enabled,
    backupCodesRemaining: Number(rows[0]?.backup_left || 0),
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
  return { uid: rows[0].id, username: rows[0].username, email: rows[0].email, role: rows[0].role };
}

async function setUserRole(uid, role, actor) {
  assertValidRole(role);
  const { rows: existing } = await query(
    'SELECT id, role, email, username FROM users WHERE id = $1',
    [uid]
  );
  if (!existing[0]) throw HttpError.notFound(`No user with id ${uid}`);
  if (existing[0].role === 'Owner' && (!actor || actor.role !== 'Owner')) {
    throw HttpError.forbidden('Only an Owner can change another Owner\'s role');
  }
  if ((role === 'Owner' || role === 'Admin') && (!actor || actor.role !== 'Owner')) {
    throw HttpError.forbidden('Only an Owner can assign the Owner or Admin role');
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
    'SELECT username, mfa_enabled FROM users WHERE id = $1',
    [user.uid]
  );
  return {
    uid: user.uid,
    email: user.email,
    username: rows[0]?.username || user.email,
    role: user.role,
    mfaEnabled: !!rows[0]?.mfa_enabled,
    permissions: buildPermissions(user.role),
  };
}

async function listUsers() {
  const { rows } = await query(
    `SELECT id AS uid, username, email, role, status, mfa_enabled AS "mfaEnabled",
            created_at AS "createdAt", last_login_at AS "lastLoginAt"
     FROM users ORDER BY created_at DESC`
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
};
