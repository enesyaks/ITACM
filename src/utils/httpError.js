/** Error carrying an HTTP status code, thrown by services and caught by the global handler. */
class HttpError extends Error {
  constructor(status, message, details = undefined) {
    super(message);
    this.status = status;
    this.details = details;
  }

  static badRequest(message, details) { return new HttpError(400, message, details); }
  static unauthorized(message = 'Authentication required', details) { return new HttpError(401, message, details); }
  static forbidden(message = 'Insufficient permissions', details) { return new HttpError(403, message, details); }
  static notFound(message = 'Resource not found', details) { return new HttpError(404, message, details); }
  static conflict(message, details) { return new HttpError(409, message, details); }
  static tooMany(message = 'Too many requests — try again later') { return new HttpError(429, message); }
}

module.exports = { HttpError };
