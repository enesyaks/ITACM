/**
 * The one reading of a request path that a confinement allowlist may trust.
 *
 * A confined role is allowed by PREFIX ("/api/me/…"), and a prefix test is only
 * as honest as the string it is given. "/api/me/../tickets" starts with the
 * allowed prefix while naming something else entirely. Express happens to route
 * that to the /api/me router rather than to /api/tickets, so today the guard and
 * the router agree and nothing is reachable — but that is a coincidence of two
 * components each declining to normalise, not a rule anybody wrote down. Put a
 * proxy in front that does normalise, or change routers, and the two readings
 * come apart with the allowlist on the wrong side of it.
 *
 * So a path is refused outright when it carries a traversal segment, an encoded
 * separator, a backslash or a NUL — raw or once-decoded. No legitimate call
 * from these screens contains any of them, which makes refusal free.
 *
 * @param {string} originalUrl req.originalUrl
 * @returns {string|null} the path to match, or null when it may not be trusted
 */
function confinedPath(originalUrl) {
  const raw = String(originalUrl || '').split('?')[0].split('#')[0];
  if (!raw) return '/';
  // Decode once. A string that is still encoded after one pass is somebody
  // hiding a separator behind double-encoding, and gets no second chance.
  let decoded;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null; // malformed percent-escape
  }
  for (const form of [raw, decoded]) {
    if (/[\\\0]/.test(form)) return null;
    if (form.split('/').includes('..')) return null;
  }
  // An escape that survived one decode is double-encoding: somebody wrapping a
  // separator so the single decode above hands back something still hiding one.
  // Only the decoded form is tested — rejecting every raw '%' would refuse
  // ordinary encoding in a path segment.
  if (decoded.includes('%')) return null;
  const path = decoded.replace(/\/+$/, '');
  return path || '/';
}

module.exports = { confinedPath };
