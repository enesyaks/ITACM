const router = require('express').Router();
const { authenticate, requireRole, requirePermission } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const crypto = require('crypto');
const { authProvider, permissionService, notificationService } = require('../services');
const { HttpError } = require('../utils/httpError');
const { rateLimitIp } = require('../utils/setupAccess');

// Brute-force protection: max 20 *failed* login attempts per IP per 15 minutes.
// Uses rateLimitIp (TCP peer unless TRUST_PROXY) so X-Forwarded-For cannot rotate buckets.
const loginAttempts = new Map();
function loginLimiter(req, res, next) {
  const now = Date.now();
  const ipKey = rateLimitIp(req);
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
  if (loginAttempts.size > 10000) loginAttempts.clear();
  next();
}
function bumpLoginFail(req) {
  if (req._loginLimitEntry) req._loginLimitEntry.count += 1;
}
function clearLoginFail(req) {
  if (req._loginIpKey) loginAttempts.delete(req._loginIpKey);
}

/**
 * POST /api/auth/login — { email, password }
 * → session token, or { mfaRequired, mfaToken } when MFA is enabled.
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

router.post('/logout', authenticate, asyncHandler(async (req, res) => {
  res.json({ success: true, data: await authProvider.logout(req.user) });
}));

router.post('/password', authenticate, asyncHandler(async (req, res) => {
  res.json({ success: true, data: await authProvider.changePassword(req.user, req.body || {}) });
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

/** POST /api/auth/users — create IT user. İzin: user_management:create */
router.post('/users', authenticate, requirePermission('user_management', 'create'), asyncHandler(async (req, res) => {
  guardPrivilegedRoleAssignment(req);
  res.status(201).json({ success: true, data: await authProvider.createItUser(req.body, req.user) });
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
      if (mode === 'existing') {
        await notificationService.sendMail({
          to: newOwner.email,
          subject: 'You are now the owner of this ITACM instance',
          text: `Hello ${newOwner.username},\n\n`
            + `You are now the Owner of this IT Asset Control instance.\n\n`
            + `Sign in with your existing credentials and MFA.\n`,
        });
      } else {
        await notificationService.sendMail({
          to: newOwner.email,
          subject: 'You are now the owner of this ITACM instance',
          text: `Hello ${newOwner.username},\n\n`
            + `You have been made the Owner of this IT Asset Control instance.\n\n`
            + `Sign in with:\n  Email: ${newOwner.email}\n  Temporary password: ${password}\n\n`
            + `Change this password right after signing in, and set up two-factor authentication when prompted.\n`,
        });
      }
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
