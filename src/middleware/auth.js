/**
 * Authentication & authorization middleware — backend-agnostic.
 *
 * `authenticate` extracts `Bearer <TOKEN>` from the Authorization header and
 * delegates verification to the active provider:
 *   - postgres mode: locally-issued JWT (jsonwebtoken) + live role lookup
 *
 * On success `req.user = { uid, email, role, permissionGroupId, customConstraints }`.
 * `requireRole(...roles)` gates a route to specific roles.
 *
 * `requirePermission(resource, action)` gates a route to a specific resource+action
 * using the IAM permission system. This is the PREFERRED middleware for new routes.
 * `requireRole()` is kept for backward compatibility and simple cases.
 */
const { authProvider } = require('../providers');
const { HttpError } = require('../utils/httpError');
const { needsMfaEnrollment, isMfaEnrollmentAllowedPath } = require('../utils/mfaPolicy');
const { needsPasswordChange, isPasswordChangeAllowedPath } = require('../utils/passwordPolicy');
// Allowlist of the endpoints a Portal (self-service employee) account may reach:
// its own zimmet plus the self-service auth actions. Everything else is 403.
const { isPortalAllowedPath } = require('../utils/portalPolicy');
const { isHrAllowedPath } = require('../utils/hrPolicy');

/**
 * Gates every authenticated caller must clear, whatever proved their identity
 * (session JWT or service API key). Kept in one place so a new gate can never
 * be wired into the JWT path alone and be silently skipped by API keys.
 */
function applyPostAuthGates(req) {
  // Owners without MFA may only hit enrollment / logout / verify-token.
  // Service actors are exempt inside needsMfaEnrollment().
  if (needsMfaEnrollment(req.user) && !isMfaEnrollmentAllowedPath(req.originalUrl)) {
    throw HttpError.forbidden(
      'Owners must enable MFA before using the app',
      { code: 'MFA_ENROLLMENT_REQUIRED' }
    );
  }

  // Users with a one-time/temp password must set a new one before normal API use.
  if (needsPasswordChange(req.user) && !isPasswordChangeAllowedPath(req.originalUrl)) {
    throw HttpError.forbidden(
      'You must set a new password before continuing',
      { code: 'PASSWORD_CHANGE_REQUIRED' }
    );
  }

  // Portal = untrusted self-service employee login. Confine it to its OWN
  // zimmet (/api/me/*) and self-service auth endpoints so it can never reach
  // an authenticate-only route that assumed every caller was staff.
  if (req.user.role === 'Portal' && !isPortalAllowedPath(req.originalUrl)) {
    throw HttpError.forbidden(
      'Portal accounts can only access their own zimmet',
      { code: 'PORTAL_CONFINED' }
    );
  }

  // HR = confined to request APIs + self zimmet + filtered dashboard.
  if (req.user.role === 'HR' && !isHrAllowedPath(req.originalUrl)) {
    throw HttpError.forbidden(
      'HR accounts can only access onboarding/offboarding requests and their own zimmet',
      { code: 'HR_CONFINED' }
    );
  }
}

async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');
    const apiKeyHeader = req.headers['x-api-key'];
    const rawApiKey = apiKeyHeader
      || (scheme === 'Bearer' && token && token.startsWith('itacm_') ? token : null);

    if (rawApiKey) {
      const apiKeyService = require('../providers/postgres/apiKeyService');
      const user = await apiKeyService.verifyRawKey(String(rawApiKey));
      if (!user) throw HttpError.unauthorized('Invalid API key');
      req.user = user;
      applyPostAuthGates(req);
      return next();
    }

    if (scheme !== 'Bearer' || !token) {
      throw HttpError.unauthorized('Missing Authorization: Bearer <TOKEN> header');
    }

    const verified = await authProvider.verifyToken(token);
    // Enrich user with IAM info (permissionGroupId, customConstraints)
    const { query } = require('../providers/postgres/pool');
    const { rows } = await query(
      'SELECT permission_group_id AS "permissionGroupId", custom_constraints AS "customConstraints" FROM users WHERE id = $1',
      [verified.uid]
    );
    req.user = {
      ...verified,
      permissionGroupId: rows[0]?.permissionGroupId || null,
      customConstraints: rows[0]?.customConstraints || null,
    };

    applyPostAuthGates(req);

    next();
  } catch (err) {
    next(err instanceof HttpError ? err : HttpError.unauthorized('Invalid token'));
  }
}


function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) return next(HttpError.unauthorized());
    if (!allowedRoles.includes(req.user.role)) {
      return next(HttpError.forbidden(`Requires role: ${allowedRoles.join(' or ')}`));
    }
    next();
  };
}

/**
 * IAM Granüler İzin Middleware'i.
 *
 * Kullanım: requirePermission('asset', 'create')
 *          requirePermission('license', 'read', { department: req.query.department })
 *
 * @param {string} resource - 'asset', 'license', 'employee', 'contract' vb.
 * @param {string} action - 'read', 'create', 'update', 'delete', 'assign' vb.
 * @param {Function|Object} [getContext] - İsteğe bağlı: context nesnesi veya req'den context çıkaran fonksiyon
 */
function requirePermission(resource, action, getContext) {
  return async (req, res, next) => {
    try {
      if (!req.user) return next(HttpError.unauthorized());

      let context = {};
      if (typeof getContext === 'function') {
        context = await getContext(req);
      } else if (getContext && typeof getContext === 'object') {
        context = getContext;
      }

      const { permissionService } = require('../services');
      const allowed = await permissionService.checkPermission(req.user, resource, action, context);

      if (!allowed) {
        return next(HttpError.forbidden(
          `Access denied: insufficient permissions for ${resource}:${action}`
        ));
      }
      next();
    } catch (err) {
      next(err instanceof HttpError ? err : HttpError.forbidden('Permission check failed'));
    }
  };
}

/**
 * En az bir (resource, action) çifti yeterli.
 * Kullanım: requireAnyPermission([['asset','unassign'],['asset','update']], getContext)
 */
function requireAnyPermission(checks, getContext) {
  return async (req, res, next) => {
    try {
      if (!req.user) return next(HttpError.unauthorized());
      let context = {};
      if (typeof getContext === 'function') context = await getContext(req);
      else if (getContext && typeof getContext === 'object') context = getContext;

      const { permissionService } = require('../services');
      const ok = await permissionService.checkAnyPermission(
        req.user,
        (checks || []).map(([resource, action]) => ({ resource, action, context }))
      );
      if (!ok) {
        const label = (checks || []).map(([r, a]) => `${r}:${a}`).join(' | ');
        return next(HttpError.forbidden(`Access denied: need one of ${label}`));
      }
      next();
    } catch (err) {
      next(err instanceof HttpError ? err : HttpError.forbidden('Permission check failed'));
    }
  };
}

/**
 * Gate API-key callers by scopes. Session JWTs (no scopes / human users) always pass —
 * role checks still apply. Scopes of `*` grant everything.
 */
function requireScope(...needed) {
  return (req, res, next) => {
    if (!req.user) return next(HttpError.unauthorized());
    const scopes = req.user.scopes;
    if (!scopes || !Array.isArray(scopes) || scopes.includes('*')) return next();
    if (needed.some((s) => scopes.includes(s))) return next();
    return next(HttpError.forbidden(`API key missing scope: ${needed.join(' or ')}`));
  };
}

/**
 * All listed (resource, action) pairs required (AND).
 * Kullanım: requireAllPermissions([['document','create'],['employee','view_handover']], getContext)
 */
function requireAllPermissions(checks, getContext) {
  return async (req, res, next) => {
    try {
      if (!req.user) return next(HttpError.unauthorized());
      let context = {};
      if (typeof getContext === 'function') context = await getContext(req);
      else if (getContext && typeof getContext === 'object') context = getContext;

      const { permissionService } = require('../services');
      const ok = await permissionService.checkAllPermissions(
        req.user,
        (checks || []).map(([resource, action]) => ({ resource, action, context }))
      );
      if (!ok) {
        const label = (checks || []).map(([r, a]) => `${r}:${a}`).join(' + ');
        return next(HttpError.forbidden(`Access denied: need all of ${label}`));
      }
      next();
    } catch (err) {
      next(err instanceof HttpError ? err : HttpError.forbidden('Permission check failed'));
    }
  };
}

module.exports = {
  authenticate,
  requireRole,
  requirePermission,
  requireAnyPermission,
  requireAllPermissions,
  requireScope,
};
