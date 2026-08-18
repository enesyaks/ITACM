const router = require('express').Router();
const { authenticate, requireRole, requirePermission } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const crypto = require('crypto');
const { authProvider, permissionService, notificationService } = require('../services');
const jwt = require('jsonwebtoken');
const { HttpError } = require('../utils/httpError');
const { rateLimitIp } = require('../utils/setupAccess');
const { ipInCidrList } = require('../utils/ipMatch');
const oidc = require('../utils/oidc');
const ssoService = require('../providers/postgres/ssoService');
const config = require('../config');

const SSO_COOKIE = 'itacm_sso';
function isSecureReq(req) {
  return req.secure || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}
function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > -1 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

// Per-IP login backstop: max 20 *failed* attempts per IP per 15 minutes — catches
// spraying across many unknown emails from one source. The precise, per-account
// lockout lives in authProvider. Trusted networks (office egress behind NAT) are
// exempt here so colleagues sharing an IP don't lock each other out; each of
// their accounts is still protected individually by the per-account lockout.
const loginAttempts = new Map();
function loginLimiter(req, res, next) {
  const now = Date.now();
  const ipKey = rateLimitIp(req);
  const trusted = config.security.trustedCidrs;
  if (trusted.length && ipInCidrList(ipKey, trusted)) return next();
  req._loginIpKey = ipKey;
  let entry = loginAttempts.get(ipKey);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + 15 * 60 * 1000 };
    loginAttempts.set(ipKey, entry);
  }
  if (entry.count >= 20) {
    return next(HttpError.tooMany('Too many login attempts — wait 15 minutes and try again'));
  }
  req._loginLimitEntry = entry;
  // Bound memory by sweeping only EXPIRED buckets — never wipe live counters,
  // which would let a flood of throwaway IPs reset an active attacker's window.
  if (loginAttempts.size > 10000) {
    for (const [key, e] of loginAttempts) {
      if (now > e.resetAt) loginAttempts.delete(key);
    }
  }
  next();
}
function bumpLoginFail(req) {
  if (req._loginLimitEntry) req._loginLimitEntry.count += 1;
}
function clearLoginFail(req) {
  if (req._loginIpKey) loginAttempts.delete(req._loginIpKey);
}

/**
 * POST /api/auth/login — { email, password, rememberMe? }
 * → session token, or { mfaRequired, mfaToken } when MFA is enabled.
 * rememberMe: true issues a longer-lived JWT (JWT_REMEMBER_EXPIRES_IN, default 30d).
 */
router.post('/login', loginLimiter, asyncHandler(async (req, res) => {
  const meta = { ip: rateLimitIp(req), userAgent: req.headers['user-agent'] || null };
  try {
    const data = await authProvider.login(req.body || {}, meta);
    if (!data.mfaRequired) clearLoginFail(req);
    res.json({ success: true, data });
  } catch (err) {
    bumpLoginFail(req);
    throw err;
  }
}));

/**
 * POST /api/auth/mfa/verify — { mfaToken, code } or { mfaToken, backupCode }
 */
router.post('/mfa/verify', loginLimiter, asyncHandler(async (req, res) => {
  const meta = { ip: rateLimitIp(req), userAgent: req.headers['user-agent'] || null };
  try {
    const data = await authProvider.verifyMfaLogin(req.body || {}, meta);
    clearLoginFail(req);
    res.json({ success: true, data });
  } catch (err) {
    bumpLoginFail(req);
    throw err;
  }
}));

/* ---------------------------------- SSO ----------------------------------
 * OpenID Connect, Authorization Code + PKCE. Invite-only (authProvider links to
 * an existing user only). The PKCE verifier / state / nonce ride a short-lived,
 * signed, HttpOnly cookie between /start and /callback; the finished session is
 * handed to the SPA via a 60-second one-time ticket in the URL hash so the
 * long-lived JWT never lands in browser history or access logs.
 */

// GET /api/auth/sso/start — send the browser to the identity provider.
router.get('/sso/start', asyncHandler(async (req, res) => {
  const cfg = await ssoService.getSsoConfig();
  const { url, codeVerifier, state, nonce } = await oidc.beginAuth(cfg);
  const stash = jwt.sign({ codeVerifier, state, nonce }, config.jwtSecret, { expiresIn: '10m' });
  res.cookie(SSO_COOKIE, stash, {
    httpOnly: true, secure: isSecureReq(req), sameSite: 'lax',
    maxAge: 10 * 60 * 1000, path: '/api/auth/sso',
  });
  res.redirect(url);
}));

// GET /api/auth/sso/callback — the IdP redirects here with ?code&state.
router.get('/sso/callback', asyncHandler(async (req, res) => {
  const stashRaw = readCookie(req, SSO_COOKIE);
  res.clearCookie(SSO_COOKIE, { path: '/api/auth/sso' });
  let stash;
  try { stash = jwt.verify(stashRaw || '', config.jwtSecret); }
  catch { return res.redirect('/#sso_error=expired'); }
  const cfg = await ssoService.getSsoConfig();
  const callbackUrl = new URL(cfg.redirectUri).origin + req.originalUrl;
  let claims;
  try {
    claims = await oidc.completeAuth(cfg, callbackUrl, stash);
  } catch {
    return res.redirect('/#sso_error=verify');
  }
  try {
    const session = await authProvider.loginWithOidc(claims, cfg, {
      ip: rateLimitIp(req), userAgent: req.headers['user-agent'] || null,
    });
    const ticket = jwt.sign({ purpose: 'sso_handoff', token: session.token }, config.jwtSecret, { expiresIn: '60s' });
    return res.redirect('/#sso_ticket=' + encodeURIComponent(ticket));
  } catch (err) {
    const code = (err && err.details && err.details.code) || 'denied';
    return res.redirect('/#sso_error=' + encodeURIComponent(code));
  }
}));

// POST /api/auth/sso/exchange — SPA swaps the one-time ticket for the session.
router.post('/sso/exchange', asyncHandler(async (req, res) => {
  const ticket = req.body && req.body.ticket;
  let payload;
  try { payload = jwt.verify(String(ticket || ''), config.jwtSecret); }
  catch { throw HttpError.unauthorized('Invalid or expired SSO ticket'); }
  if (payload.purpose !== 'sso_handoff' || !payload.token) throw HttpError.unauthorized('Invalid SSO ticket');
  res.json({ success: true, data: { token: payload.token } });
}));

router.post('/logout', authenticate, asyncHandler(async (req, res) => {
  res.json({ success: true, data: await authProvider.logout(req.user) });
}));

router.post('/password', authenticate, asyncHandler(async (req, res) => {
  const meta = { ip: rateLimitIp(req), userAgent: req.headers['user-agent'] || null };
  res.json({ success: true, data: await authProvider.changePassword(req.user, req.body || {}, meta) });
}));

router.get('/mfa', authenticate, asyncHandler(async (req, res) => {
  res.json({ success: true, data: await authProvider.mfaStatus(req.user) });
}));

router.post('/mfa/setup', authenticate, asyncHandler(async (req, res) => {
  res.json({ success: true, data: await authProvider.mfaSetupStart(req.user) });
}));

router.post('/mfa/enable', authenticate, asyncHandler(async (req, res) => {
  res.json({ success: true, data: await authProvider.mfaSetupConfirm(req.user, req.body || {}) });
}));

router.post('/mfa/disable', authenticate, asyncHandler(async (req, res) => {
  res.json({ success: true, data: await authProvider.mfaDisable(req.user, req.body || {}) });
}));

/**
 * POST /api/auth/verify-token — Authorization: Bearer <TOKEN>
 */
router.post('/verify-token', authenticate, asyncHandler(async (req, res) => {
  await authProvider.recordLogin(req.user, {
    ip: rateLimitIp(req),
    userAgent: req.headers['user-agent'] || null,
  });
  res.json({ success: true, data: await authProvider.getVerifiedProfile(req.user) });
}));

/** Only Owner may assign Owner or Admin; Admin may create/promote Helpdesk & Viewer. */
function guardPrivilegedRoleAssignment(req) {
  const role = req.body && req.body.role;
  if (role === 'Owner' || role === 'Admin') {
    if (req.user.role !== 'Owner') {
      throw HttpError.forbidden('Only an Owner can assign the Owner or Admin role');
    }
  }
}

/** GET /api/auth/users — list IT users. İzin: user_management:read */
router.get('/users', authenticate, requirePermission('user_management', 'read'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await authProvider.listUsers() });
}));

/**
 * GET /api/auth/users/employee-candidates?q= — Active employees who do not yet
 * have a login, for the "assign a role to an existing person" picker.
 * İzin: user_management:create (same gate as creating the account).
 */
router.get('/users/employee-candidates', authenticate, requirePermission('user_management', 'create'), asyncHandler(async (req, res) => {
  // `search` is what the shared employee picker sends; `q` is accepted too.
  const term = req.query.search != null ? req.query.search : req.query.q;
  const data = await authProvider.listEmployeeCandidates(term, req.query.limit);
  res.json({ success: true, data });
}));

/**
 * POST /api/auth/users — create an IT user, either from scratch
 * ({ username, email }) or by promoting an existing person ({ employeeId }).
 *
 * password is optional: omitted, a temporary one is generated and the account
 * must change it at first sign-in. Same delivery contract as employee
 * grant-access — SMTP on → emailed and never returned; SMTP off or send
 * failed → returned once so the admin can hand it over.
 * İzin: user_management:create
 */
router.post('/users', authenticate, requirePermission('user_management', 'create'), asyncHandler(async (req, res) => {
  guardPrivilegedRoleAssignment(req);
  const created = await authProvider.createItUser(req.body || {}, req.user);
  const { tempPassword, generated, ...user } = created;

  const { smtp } = await notificationService.getMailConfig();
  const smtpOn = !!(smtp && smtp.host);
  let emailStatus = 'skipped';
  let emailError = null;
  if (smtpOn) {
    try {
      await notificationService.sendPortalAccessEmail({
        to: user.email,
        username: user.username,
        tempPassword,
      });
      emailStatus = 'sent';
    } catch (err) {
      console.warn('[notify] IT user credentials email failed:', err.message);
      emailStatus = 'failed';
      emailError = err.message || 'Email send failed';
    }
  }
  // Reveal only when it wasn't (successfully) emailed — and never echo back a
  // password the admin typed themselves; they already have it.
  const reveal = generated && (!smtpOn || emailStatus === 'failed');
  res.status(201).json({
    success: true,
    data: {
      ...user,
      generated,
      smtpUsed: smtpOn,
      emailStatus,
      emailError: emailError || undefined,
      tempPassword: reveal ? tempPassword : undefined,
    },
  });
}));

/** PUT /api/auth/users/:uid/role — change user role. İzin: user_management:update */
router.put('/users/:uid/role', authenticate, requirePermission('user_management', 'update'), asyncHandler(async (req, res) => {
  guardPrivilegedRoleAssignment(req);
  res.json({ success: true, data: await authProvider.setUserRole(req.params.uid, req.body.role, req.user) });
}));

/** GET /api/auth/users/admin-logs — admin action logs. İzin: user_management:read */
router.get('/users/admin-logs', authenticate, requirePermission('user_management', 'read'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await authProvider.getAdminLogs(String(req.query.email || ''), req.query.limit) });
}));

/** PUT /api/auth/users/:uid/status — disable/enable user. İzin: user_management:update */
router.put('/users/:uid/status', authenticate, requirePermission('user_management', 'update'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await authProvider.setUserStatus(req.params.uid, req.body.status, req.user) });
}));

/** DELETE /api/auth/users/:uid — delete user. İzin: user_management:delete */
router.delete('/users/:uid', authenticate, requirePermission('user_management', 'delete'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await authProvider.deleteUser(req.params.uid, req.user) });
}));

/** GET /api/auth/users/:uid/logins — login logs. İzin: user_management:read */
router.get('/users/:uid/logins', authenticate, requirePermission('user_management', 'read'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await authProvider.getLoginLogs(req.params.uid, req.query.limit) });
}));

/** GET /api/auth/owner/transfer/preflight — Owner-only; tells the UI whether SMTP will
 *  email the invite and whether the caller has an MFA code to confirm with. */
router.get('/owner/transfer/preflight', authenticate, asyncHandler(async (req, res) => {
  if (!req.user || req.user.role !== 'Owner') throw HttpError.forbidden('Only an Owner can transfer ownership');
  const { smtp } = await notificationService.getMailConfig();
  const pre = await authProvider.ownerTransferPreflight(req.user);
  res.json({
    success: true,
    data: {
      smtpConfigured: !!(smtp && smtp.host),
      mfaEnrolled: pre.mfaEnrolled,
      candidates: pre.candidates || [],
    },
  });
}));

/** POST /api/auth/owner/transfer — hand the Owner role to a new account and step the
 *  caller down to Admin, confirmed by the caller's TOTP. Owner-only; loginLimiter
 *  throttles code guessing. Body: { targetUserId, code } or { email, username, code, password? }. */
router.post('/owner/transfer', authenticate, loginLimiter, asyncHandler(async (req, res) => {
  if (!req.user || req.user.role !== 'Owner') throw HttpError.forbidden('Only an Owner can transfer ownership');
  const { email, username, code, targetUserId } = req.body || {};
  const { smtp } = await notificationService.getMailConfig();
  const smtpOn = !!(smtp && smtp.host);

  let result;
  let password;
  if (targetUserId) {
    result = await authProvider.transferOwnership({ targetUserId, code }, req.user);
  } else {
    // SMTP on: generate a strong temp password and email it, so the acting Owner never
    // sees it. SMTP off: the acting Owner sets it inline and shares it out-of-band.
    password = smtpOn
      ? crypto.randomBytes(12).toString('base64url')
      : String((req.body || {}).password || '');
    result = await authProvider.transferOwnership({ email, username, password, code }, req.user);
  }
  const { newOwner, mode } = result;

  let emailStatus = 'skipped';
  let tempPassword;
  if (smtpOn) {
    try {
      // Body comes from the editable `owner_transfer` template; only the
      // credentials line differs between an existing and a freshly created user.
      await notificationService.sendOwnerTransferEmail({
        to: newOwner.email,
        username: newOwner.username,
        credentials: mode === 'existing'
          ? 'Sign in with your existing credentials and MFA.'
          : `Sign in with:\n  Email: ${newOwner.email}\n  Temporary password: ${password}\n`
            + 'Change this password right after signing in.',
      });
      emailStatus = 'sent';
    } catch (err) {
      emailStatus = 'failed';
      if (mode === 'create') tempPassword = password;
    }
  }
  res.json({ success: true, data: { newOwner, mode, smtpUsed: smtpOn, emailStatus, tempPassword } });
}));

/** ================================================================ */
/** IAM PERMISSION YÖNETİM ROUTE'LARI */
/** ================================================================ */

/** GET /api/auth/iam-schema — canonical resource→actions matrix (for UI). */
router.get('/iam-schema', authenticate, requirePermission('user_management', 'read'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: permissionService.getIamSchema() });
}));

/** GET /api/auth/permission-groups — list all permission groups. İzin: user_management:read */
router.get('/permission-groups', authenticate, requirePermission('user_management', 'read'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await permissionService.listPermissionGroups() });
}));

/** GET /api/auth/permission-groups/:id — get group details. İzin: user_management:read */
router.get('/permission-groups/:id', authenticate, requirePermission('user_management', 'read'), asyncHandler(async (req, res) => {
  const data = await permissionService.getPermissionGroup(req.params.id);
  if (!data) return res.status(404).json({ success: false, error: 'Permission group not found' });
  res.json({ success: true, data });
}));

/** POST /api/auth/permission-groups — create custom group. İzin: user_management:create */
router.post('/permission-groups', authenticate, requirePermission('user_management', 'create'), asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, data: await permissionService.createPermissionGroup(req.body || {}, req.user) });
}));

/** PUT /api/auth/permission-groups/:id — update group. İzin: user_management:update */
router.put('/permission-groups/:id', authenticate, requirePermission('user_management', 'update'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await permissionService.updatePermissionGroup(req.params.id, req.body || {}, req.user) });
}));

/** DELETE /api/auth/permission-groups/:id — delete custom group. İzin: user_management:delete */
router.delete('/permission-groups/:id', authenticate, requirePermission('user_management', 'delete'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await permissionService.deletePermissionGroup(req.params.id, req.user) });
}));

/** POST /api/auth/permission-groups/:id/entries — add permission entry. İzin: user_management:update */
router.post('/permission-groups/:id/entries', authenticate, requirePermission('user_management', 'update'), asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, data: await permissionService.addPermissionEntry(req.params.id, req.body || {}, req.user) });
}));

/** PUT /api/auth/permission-groups/:groupId/entries/:entryId — update entry. İzin: user_management:update */
router.put('/permission-groups/:groupId/entries/:entryId', authenticate, requirePermission('user_management', 'update'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await permissionService.updatePermissionEntry(req.params.entryId, req.body || {}, req.user) });
}));

/** DELETE /api/auth/permission-groups/:groupId/entries/:entryId — delete entry. İzin: user_management:update */
router.delete('/permission-groups/:groupId/entries/:entryId', authenticate, requirePermission('user_management', 'update'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await permissionService.deletePermissionEntry(req.params.entryId, req.user) });
}));

/** DELETE /api/auth/permission-groups/:id/entries?resource=&action= — remove all entries for resource+action (matrix toggle). */
router.delete('/permission-groups/:id/entries', authenticate, requirePermission('user_management', 'update'), asyncHandler(async (req, res) => {
  const resource = String(req.query.resource || '');
  const action = String(req.query.action || '');
  if (!resource || !action) {
    return res.status(400).json({ success: false, error: 'resource and action query params are required' });
  }
  res.json({
    success: true,
    data: await permissionService.deletePermissionEntriesForAction(req.params.id, resource, action, req.user),
  });
}));

/** PUT /api/auth/users/:uid/permission-group — set user's permission group. İzin: user_management:update */
router.put('/users/:uid/permission-group', authenticate, requirePermission('user_management', 'update'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await permissionService.setUserPermissionGroup(req.params.uid, (req.body || {}).groupId, req.user) });
}));

/** PUT /api/auth/users/:uid/custom-constraints — set user's custom constraints. İzin: user_management:update */
router.put('/users/:uid/custom-constraints', authenticate, requirePermission('user_management', 'update'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await permissionService.setUserCustomConstraints(req.params.uid, req.body || {}, req.user) });
}));

/** GET /api/auth/my-permissions — current user's effective permissions. Oturum açan kullanıcı her zaman erişebilir. */
router.get('/my-permissions', authenticate, asyncHandler(async (req, res) => {
  res.json({ success: true, data: await permissionService.getUserPermissions(req.user) });
}));

module.exports = router;
