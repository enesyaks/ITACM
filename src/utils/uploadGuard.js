/**
 * Upload validation for user-provided documents (handover scans, repair papers).
 *
 * Defends against malicious uploads by:
 *   - verifying the REAL file type from its magic bytes (never trusting the
 *     client-declared MIME, which is trivially spoofable),
 *   - allowing only PDF / PNG / JPEG / WebP,
 *   - enforcing a hard size cap,
 *   - sanitising the filename (strip path separators, control chars, quotes)
 *     so it can't break the Content-Disposition header or carry surprises.
 *
 * Downloads are always served with Content-Disposition: attachment and the
 * global X-Content-Type-Options: nosniff header, so even an allowed image can't
 * be rendered inline as script.
 */
const { HttpError } = require('./httpError');

const MAX_BYTES = 8 * 1024 * 1024; // 8MB
const EXT = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

/** Detect the true type from the leading bytes; null if not an allowed type. */
function sniffType(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) return 'application/pdf'; // %PDF
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
      buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'image/webp'; // RIFF..WEBP
  return null;
}

/** Drop path separators, control chars (code < 32 or 127) and quotes; keep unicode
 *  letters (incl. Turkish) and cap the length. */
function safeFilename(name, fallbackExt) {
  const raw = String(name || '').split(/[\\/]/).pop() || '';
  let base = Array.from(raw)
    .filter((ch) => { const c = ch.charCodeAt(0); return c >= 32 && c !== 127 && ch !== '"'; })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  if (!base) base = `document.${fallbackExt || 'bin'}`;
  return base.slice(0, 120);
}

/**
 * Validate a base64 upload. Returns { buffer, mime, filename } with the mime
 * derived from the actual bytes and a sanitised filename, or throws 400.
 */
function validateUpload({ base64, filename } = {}) {
  if (!base64) throw HttpError.badRequest('base64 file content is required');
  const buffer = Buffer.from(String(base64).split(',').pop(), 'base64');
  if (!buffer.length) throw HttpError.badRequest('Empty file');
  if (buffer.length > MAX_BYTES) throw HttpError.badRequest('File exceeds the 8MB limit');
  const mime = sniffType(buffer);
  if (!mime) {
    throw HttpError.badRequest('Unsupported or potentially unsafe file — only PDF, PNG, JPEG or WebP are accepted');
  }
  return { buffer, mime, filename: safeFilename(filename, EXT[mime]) };
}

module.exports = { validateUpload, sniffType, safeFilename, MAX_BYTES };
