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

module.exports = { authenticate, requireRole };
