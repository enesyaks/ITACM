'use strict';

/**
 * One line per API request, on stdout, for "what did this person do at 14:30".
 *
 * Written to stdout rather than a table: promtail already ships container logs
 * to Loki, and system_audit_log answers a different question (what CHANGED)
 * with a permanent retention that request noise would swamp.
 *
 * The line carries who, when, what and from where — and deliberately nothing
 * else. An access log that records more than that becomes the thing it was
 * supposed to help you investigate.
 */
const { rateLimitIp } = require('./setupAccess');

/**
 * Paths whose own segments are credentials. /api/ack/<token> authorises a
 * handover acknowledgement with no login at all, so writing the raw path would
 * put a working credential in the log — anyone who can read logs could then
 * acknowledge on that employee's behalf.
 */
const SECRET_PATH_RE = [
  // The capture group is the prefix to keep; whatever follows is the credential.
  // Written as a prefix rather than "last segment" because a trailing slash
  // makes the last segment empty and a naive rule then leaves the token intact.
  /^(\/api\/ack\/)[^/]+/i,
];

/** Requests that say nothing about a person and would drown the ones that do. */
function isNoise(path) {
  return path === '/api/health' || path === '/api/config';
}

/**
 * Control characters let a crafted path or user-agent forge a second log line.
 * Strip them, and cap length so one request cannot push a wall of text.
 *
 * The bidi overrides go too, and for a different reason: they forge nothing but
 * they reverse how everything after them is DRAWN. A path carrying U+202E can
 * make the rendered line read differently from the line that was written — the
 * ip and user at the end can be made to appear as something else in a terminal
 * or in Grafana. A trail nobody can read literally is not a trail.
 */
function clean(value, max = 200) {
  return String(value == null ? '' : value)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    // LRM/RLM, the embedding + override block, and the isolate block.
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .slice(0, max);
}

/** Redact any trailing segment that is itself a credential. */
function safePath(path) {
  for (const re of SECRET_PATH_RE) {
    if (re.test(path)) return path.replace(re, '$1[redacted]');
  }
  return path;
}

/**
 * Query KEYS only. `?search=Ahmet Yilmaz` says who was looked up, and a filter
 * can carry a salary band or a cost ceiling — the keys are enough to know which
 * screen was used, the values are somebody's business.
 */
function safeQuery(query) {
  const keys = Object.keys(query || {});
  return keys.length ? `?${keys.slice(0, 12).sort().join(',')}` : '';
}

function accessLog(req, res, next) {
  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    try {
      const path = (req.originalUrl || req.url || '').split('?')[0];
      if (isNoise(path)) return;
      const ms = Number((process.hrtime.bigint() - startedAt) / 1000000n);
      const who = (req.user && (req.user.email || req.user.uid)) || '-';
      // rateLimitIp, not req.ip: behind the tunnel `trust proxy` resolves to the
      // last hop, which is Traefik. This prefers CF-Connecting-IP and falls back
      // to the unspoofable TCP peer when no proxy is declared.
      const ip = rateLimitIp(req) || '-';
      process.stdout.write(
        `[access] ${new Date().toISOString()} ${req.method} `
        + `${clean(safePath(path))}${clean(safeQuery(req.query), 120)} `
        + `${res.statusCode} ${ms}ms user=${clean(who, 120)} ip=${clean(ip, 60)}\n`
      );
    } catch { /* logging must never break a response */ }
  });
  next();
}

module.exports = {
  accessLog, safePath, safeQuery, clean, isNoise, SECRET_PATH_RE,
};
