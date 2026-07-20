const { HttpError } = require('../utils/httpError');

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({
      success: false,
      error: err.message,
      ...(err.details ? { details: err.details } : {}),
    });
  }

  // express.json body-parser limit
  if (err && (err.type === 'entity.too.large' || err.status === 413)) {
    return res.status(413).json({
      success: false,
      error: 'Upload too large — maximum is 8MB (PDF, PNG, JPEG or WebP)',
    });
  }

  if (err && (err.code === 'EACCES' || err.code === 'EPERM')) {
    // Log the detailed message (incl. path) server-side; never return it — the
    // filesystem path is internal and must not leak to clients.
    console.error('Storage permission error:', err.message);
    return res.status(500).json({
      success: false,
      error: 'Document storage is not writable on the server',
    });
  }

  console.error('Unhandled error:', err);
  return res.status(500).json({ success: false, error: 'Internal server error' });
}

function notFoundHandler(req, res) {
  res.status(404).json({ success: false, error: `Route not found: ${req.method} ${req.path}` });
}

module.exports = { errorHandler, notFoundHandler };
