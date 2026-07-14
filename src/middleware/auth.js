/**
 * Authentication & authorization middleware — backend-agnostic.
 *
 * `authenticate` extracts `Bearer <TOKEN>` from the Authorization header and
 * delegates verification to the active provider:
 *   - postgres mode: locally-issued JWT (jsonwebtoken) + live role lookup
 *
 * On success `req.user = { uid, email, role }`.
 * `requireRole(...roles)` gates a route to specific roles.
 */
const { authProvider } = require('../providers');
const { HttpError } = require('../utils/httpError');

async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');
    const apiKeyHeader = req.headers['x-api-key'];

    if (apiKeyHeader) {
      const apiKeyService = require('../providers/postgres/apiKeyService');
      const user = await apiKeyService.verifyRawKey(String(apiKeyHeader));
      if (!user) throw HttpError.unauthorized('Invalid API key');
      req.user = user;
      return next();
    }

    if (scheme === 'Bearer' && token && token.startsWith('itacm_')) {
      const apiKeyService = require('../providers/postgres/apiKeyService');
      const user = await apiKeyService.verifyRawKey(token);
      if (!user) throw HttpError.unauthorized('Invalid API key');
      req.user = user;
      return next();
    }

    if (scheme !== 'Bearer' || !token) {
      throw HttpError.unauthorized('Missing Authorization: Bearer <TOKEN> header');
    }

    req.user = await authProvider.verifyToken(token);
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

module.exports = { authenticate, requireRole, requireScope };
