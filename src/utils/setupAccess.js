/**
 * Who may receive the one-time setupToken over the API.
 * Loopback clients (typical Docker/desktop first-run) get it automatically.
 * Remote clients must supply SETUP_TOKEN env (or the key printed in server logs)
 * via the onboarding form — the token is never broadcast on /api/config.
 */
function normalizeIp(ip) {
  const s = String(ip || '').replace(/^::ffff:/i, '');
  return s === '::1' ? '127.0.0.1' : s;
}

function isLoopbackIp(ip) {
  const s = normalizeIp(ip);
  return s === '127.0.0.1' || s === 'localhost';
}

/** Reveal setupToken in API responses only for trusted clients. */
function canRevealSetupToken(req) {
  if (['1', 'true', 'yes'].includes(String(process.env.SETUP_TOKEN_PUBLIC || '').toLowerCase())) {
    return true;
  }
  return isLoopbackIp(req && req.ip);
}

module.exports = { canRevealSetupToken, isLoopbackIp, normalizeIp };
