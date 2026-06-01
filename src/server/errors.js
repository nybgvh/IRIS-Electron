/*
 * Typed errors. Services throw these; the host layer (IPC adapter or Express
 * route) catches them and maps to the response envelope.
 *
 *   AuthError      → 401 Unauthorized
 *   ForbiddenError → 403 Forbidden
 *   NotFoundError  → 404 Not Found
 *   ValidationError→ 400 Bad Request
 *   AppError       → 500 Internal Server Error (generic fallback)
 *
 * The `code` field is a short machine-readable string the renderer can
 * branch on (e.g. 'auth/invalid-credentials').
 */

class AppError extends Error {
  constructor(message, code = 'app/error') {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
  }
}

class AuthError extends AppError {
  constructor(message = 'Not authenticated', code = 'auth/unauthenticated') {
    super(message, code);
  }
}

class ForbiddenError extends AppError {
  constructor(message = 'Forbidden', code = 'auth/forbidden') {
    super(message, code);
  }
}

class NotFoundError extends AppError {
  constructor(message = 'Not found', code = 'app/not-found') {
    super(message, code);
  }
}

class ValidationError extends AppError {
  constructor(message = 'Invalid input', code = 'app/invalid') {
    super(message, code);
  }
}

module.exports = {
  AppError,
  AuthError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
};
