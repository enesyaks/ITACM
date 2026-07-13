/** Safe Content-Disposition value for downloads (ASCII + RFC 5987 UTF-8). */
function contentDisposition(filename, { inline = false } = {}) {
  const raw = String(filename || 'document').replace(/[\r\n"]/g, '_').trim() || 'document';
  const ascii = raw.replace(/[^\x20-\x7E]/g, '_').replace(/\\/g, '_') || 'document';
  const encoded = encodeURIComponent(raw).replace(/['()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  const type = inline ? 'inline' : 'attachment';
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

module.exports = { contentDisposition };
