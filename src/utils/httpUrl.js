/** Validate external http(s) URLs for storage (reject javascript:/data:/etc.). */
const { HttpError } = require('./httpError');

function sanitizeHttpUrl(raw, { max = 500, field = 'url' } = {}) {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (s.length > max) throw HttpError.badRequest(`${field} too long (max ${max})`);
  let u;
  try {
    u = new URL(s);
  } catch {
    throw HttpError.badRequest(`${field} must be a valid URL (https://…)`);
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw HttpError.badRequest(`${field} must use http or https`);
  }
  if (u.username || u.password) {
    throw HttpError.badRequest(`${field} must not include credentials`);
  }
  return u.toString().slice(0, max);
}

module.exports = { sanitizeHttpUrl };
