/**
 * Local auth provider (postgres mode) — self-contained Email/Password auth.
 *
 * POST /api/auth/login issues a signed JWT carrying { sub, email, role }.
 * verifyToken() validates the signature AND re-reads the user row so role
 * changes / deletions take effect immediately.
 */
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('./pool');
const config = require('../../config');
const { HttpError } = require('../../utils/httpError');
const { ROLES, buildPermissions } = require('../../utils/permissions');

function assertValidRole(role) {
  if (!ROLES.includes(role)) {
    throw HttpError.badRequest(`Invalid role "${role}". Must be one of: ${ROLES.join(', ')}`);
  }
}

// Compared against when the email is unknown, so a login attempt costs one
// bcrypt verification either way — response TIMING no longer reveals whether
// an account exists (the error text was already identical).
const DUMMY_HASH = bcrypt.hashSync('itacm-timing-equalizer', 12);

async function login({ email, password }, meta = {}) {
  if (!email || !password) throw HttpError.badRequest('email and password are required');

  const { rows } = await query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
  const user = rows[0];
  // Same error for unknown email and wrong password — no account enumeration.
  const match = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
  const valid = user && match;
  if (!valid) throw HttpError.unauthorized('Invalid email or password');
  if (user.status === 'Disabled') throw HttpError.forbidden('This account has been disabled — contact your Owner');

  const token = jwt.sign(
    { sub: user.id, email: user.email, role: user.role },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn, issuer: 'itacm' }
  );

  // Login audit: last_login_at on the user + one row per sign-in.
  await query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
  await query(
    'INSERT INTO login_logs (user_id, email, ip, user_agent) VALUES ($1, $2, $3, $4)',
    [user.id, user.email, meta.ip || null, meta.userAgent || null]
  );

  return {
    token,
    expiresIn: config.jwtExpiresIn,
    user: { uid: user.id, username: user.username, email: user.email, role: user.role },
  };
}

async function verifyToken(token) {
  let payload;
  try {
    // Algorithm pinned so a token can never downgrade to a weaker/none alg.
    payload = jwt.verify(token, config.jwtSecret, { issuer: 'itacm', algorithms: ['HS256'] });
  } catch (err) {
    throw err.name === 'TokenExpiredError'
      ? HttpError.unauthorized('Token expired — sign in again')
      : HttpError.unauthorized('Invalid token');
  }

  // Live lookup: deleted/disabled users are locked out and role changes apply instantly.
  const { rows } = await query('SELECT id, email, role, username, status FROM users WHERE id = $1', [payload.sub]);
  if (!rows[0]) throw HttpError.unauthorized('Account no longer exists');
  if (rows[0].status === 'Disabled') throw HttpError.unauthorized('This account has been disabled');

  return { uid: rows[0].id, email: rows[0].email, role: rows[0].role, username: rows[0].username };
}

/** Postgres mode logs logins inside login(); verify-token resume is not a login. */
async function recordLogin() { /* no-op */ }

async function getLoginLogs(uid, limit = 25) {
  const { rows } = await query(
    `SELECT id, email, ip, user_agent AS "userAgent", "timestamp"
     FROM login_logs WHERE user_id = $1 ORDER BY "timestamp" DESC LIMIT $2`,
    [uid, Math.min(Number(limit) || 25, 100)]
  );
  return rows;
}

async function createItUser({ username, email, password, role }) {
  if (!username || !email || !password) {
    throw HttpError.badRequest('username, email and password are required');
  }
  if (password.length < 8) throw HttpError.badRequest('Password must be at least 8 characters');
  assertValidRole(role);

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

/** Onboarding: create the Owner account, or reset the seeded one's credentials. */
async function upsertAdmin({ username, email, password }) {
  return upsertAdminTx(null, { username, email, password });
}

async function upsertAdminTx(client, { username, email, password }) {
  if (!username || !email || !password) {
    throw HttpError.badRequest('username, email and password are required');
  }
  if (password.length < 8) throw HttpError.badRequest('Password must be at least 8 characters');

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
  const { rows } = await query(
    'UPDATE users SET role = $2 WHERE id = $1 RETURNING id, role, email, username',
    [uid, role]
  );
  if (actor) await logAdminAction(rows[0], 'role_changed', actor.username || actor.email, `→ ${role}`);
  return { uid, role };
}

async function getVerifiedProfile(user) {
  const { rows } = await query('SELECT username FROM users WHERE id = $1', [user.uid]);
  return {
    uid: user.uid,
    email: user.email,
    username: rows[0]?.username || user.email,
    role: user.role,
    permissions: buildPermissions(user.role),
  };
}

async function listUsers() {
  const { rows } = await query(
    `SELECT id AS uid, username, email, role, status, created_at AS "createdAt",
            last_login_at AS "lastLoginAt"
     FROM users ORDER BY created_at DESC`
  );
  return rows;
}

/* ---- Owner-only account administration (audited in user_admin_logs) ---- */

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
  // login_logs cascade; handovers keep it_user_id/name (denormalised) for history.
  await query('DELETE FROM users WHERE id = $1', [uid]);
  await logAdminAction(target, 'deleted', actor.username || actor.email, `role was ${target.role}`);
  return { uid, deleted: true };
}

/** Admin actions (disable/enable/delete/role) for one account, newest first. */
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
  login, verifyToken, recordLogin, getLoginLogs,
  createItUser, upsertAdmin, upsertAdminTx, setUserRole, getVerifiedProfile, listUsers,
  setUserStatus, deleteUser, getAdminLogs,
};
