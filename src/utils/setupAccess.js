We are asked to apply a suggested edit to the original code. The suggested edit changes the rateLimitIp function to first check for Cloudflare's CF-Connecting-IP header, then fall back to peerIp. The original function just returned peerIp || 'unknown'. The suggestion includes a comment that also describes the change. The instruction: "Apply the SUGGESTED EDIT to the ORIGINAL CODE. Output the complete modified file. Output ONLY code. Do NOT explain, summarize, or describe changes. Leave existing comments in place unless changes require modifying them. Preserve all unchanged code exactly as-is." So we need to output the entire file with the rateLimitIp function replaced as per the suggestion. The original code includes the comment block above the function, which we will replace with the suggested comment. The function body will be replaced. The rest of the file remains unchanged. So I'll produce the complete code with that edit./**
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
 * True when a reverse proxy is trusted — must mirror app.js's `trust proxy`
 * parsing, which also accepts a numeric hop count (e.g. TRUST_PROXY=2). The
 * plain envFlag() misses those, so callers deciding whether the Host header is
 * spoofable (canRevealSetupToken) must use this instead to avoid trusting Host
 * behind a proxy.
 */
function trustProxyEnabled() {
  const raw = String(process.env.TRUST_PROXY || '').trim().toLowerCase();
  if (!raw || raw === '0' || raw === 'false' || raw === 'no') return false;
  if (/^\d+$/.test(raw)) return Number(raw) >= 1;
  return raw === '1' || raw === 'true' || raw === 'yes';
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
 * When behind Cloudflare, uses the CF-Connecting-IP header (set by Cloudflare,
 * cannot be spoofed by clients) to identify the real visitor. Otherwise, falls
 * back to the direct TCP peer address to prevent attackers from rotating
 * spoofed headers when no trusted proxy is in front.
 */
function rateLimitIp(req) {
  // Trust Cloudflare's CF-Connecting-IP header (cannot be spoofed by clients).
  const cfIp = req.headers && req.headers['cf-connecting-ip'];
  if (cfIp) return String(cfIp).trim();
  // Fall back to the direct TCP peer for non-proxied or other reverse-proxy setups.
  return peerIp(req) || 'unknown';
}

/**
 * Host header is localhost / 127.0.0.1 (optional port).
 * Used only when TRUST_PROXY is off — Docker Desktop publishes ports so the
 * TCP peer is a bridge IP, not loopback, even when the user opens localhost.
 */
function isLocalhostHostHeader(req) {
  const raw = String((req && req.headers && req.headers.host) || '').split(',')[0].trim().toLowerCase();
  if (!raw) return false;
  const host = raw.replace(/:\d+$/, '');
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
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
  if (isLoopbackIp(peerIp(req))) return true;
  // Docker Desktop / published ports: browser hits localhost but peer is the gateway.
  // Only trust Host when we are NOT behind a reverse proxy (Host would be spoofable).
  // trustProxyEnabled() also catches numeric hop counts (TRUST_PROXY=2), which
  // envFlag() would miss — leaving Host trusted behind a proxy and leaking the token.
  if (!trustProxyEnabled() && isLocalhostHostHeader(req)) return true;
  return false;
}

module.exports = {
  canRevealSetupToken,
  isLocalhostHostHeader,
  isLoopbackIp,
  normalizeIp,
  peerIp,
  rateLimitIp,
  trustProxyEnabled,
};

