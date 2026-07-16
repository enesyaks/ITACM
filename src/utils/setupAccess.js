/**
 * Who may receive the one-time setupToken over the API.
 * Loopback clients (typical Docker/desktop first-run) get it automatically.
 * Remote clients must supply SETUP_TOKEN env (or the key printed in server logs)
 * via the onboarding form — the token is never broadcast on /api/config.
 *
 * CRITICAL: Never trust X-Forwarded-For / req.ip for this decision — attackers can
 * spoof it when `trust proxy` is enabled. Always use the direct TCP peer.
 */
function normalizeIp(ip) {
  const s = String(ip || '').replace(/^::ffff:/i, '');
  return s === '::1' ? '127.0.0.1' : s;
}

function isLoopbackIp(ip) {
  const s = normalizeIp(ip);
  return s === '127.0.0.1' || s === 'localhost';
}

function envFlag(name) {
  return ['1', 'true', 'yes'].includes(String(process.env[name] || '').toLowerCase());
}

/**
 * Connection peer IP (not spoofable via X-Forwarded-For).
 */
function peerIp(req) {
  return normalizeIp(req && req.socket && req.socket.remoteAddress);
}

/**
 * IP key for rate limits and brute-force protection.
 *
 * ALWAYS uses the TCP peer address — never trusts X-Forwarded-For
 * regardless of TRUST_PROXY. This prevents attackers from rotating
 * spoofed headers to bypass rate limits or brute-force detection.
 */
function rateLimitIp(req) {
  return peerIp(req) || 'unknown';
}

/** Reveal setupToken in API responses only for trusted clients. */
function canRevealSetupToken(req) {
  if (envFlag('SETUP_TOKEN_PUBLIC')) {
    const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
    const confirmed = String(process.env.SETUP_TOKEN_PUBLIC_CONFIRM || '') === 'I_UNDERSTAND';
    if (isProd && !confirmed) {
      console.warn(
        '[itacm] SETUP_TOKEN_PUBLIC ignored in production '
        + '(set SETUP_TOKEN_PUBLIC_CONFIRM=I_UNDERSTAND to force — dangerous)'
      );
    } else {
      return true;
    }
  }
  // Direct TCP peer only — never req.ip / X-Forwarded-For.
  return isLoopbackIp(peerIp(req));
}

module.exports = {
  canRevealSetupToken,
  isLoopbackIp,
  normalizeIp,
  peerIp,
  rateLimitIp,
};
