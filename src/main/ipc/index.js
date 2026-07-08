/*
 * IPC adapter layer. Each handler:
 *   1. Resolves the current user from the auth token passed by the renderer.
 *   2. Calls the corresponding service method.
 *   3. Wraps the result (or thrown error) in the standard envelope:
 *         { ok: true,  data }      on success
 *         { ok: false, error: { code, message } }   on failure
 *
 * The envelope mirrors what a future fetch() against a real HTTP API will
 * return, so the renderer's api-client doesn't have to change when the
 * transport swaps.
 */

const { ipcMain } = require('electron');
const authService = require('../../server/services/auth-service');
const { AppError } = require('../../server/errors');

function publicError(err) {
  if (err instanceof AppError) {
    return { code: err.code, message: err.message };
  }
  // Unknown error — don't leak details to the renderer.
  console.error('[IPC] unexpected error:', err);
  return { code: 'app/error', message: 'An unexpected error occurred.' };
}

/*
 * Wraps a handler so it can take `(token, ...args)` and return the standard
 * envelope. The first argument from the renderer is always the auth token
 * (or null for unauthenticated calls like login).
 */
function envelope(handlerName, fn, { authRequired = true } = {}) {
  return async (_event, token, ...args) => {
    try {
      const currentUser = token ? authService.userFromToken(token) : null;
      if (authRequired && !currentUser) {
        return { ok: false, error: { code: 'auth/unauthenticated', message: 'Not authenticated.' } };
      }
      const data = await fn(currentUser, ...args);
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: publicError(err) };
    }
  };
}

function register(channel, fn, opts) {
  ipcMain.handle(channel, envelope(channel, fn, opts));
}

function registerAll() {
  require('./auth.ipc')(register, envelope);
  require('./users.ipc')(register, envelope);
  require('./teams.ipc')(register, envelope);
  require('./projects.ipc')(register, envelope);
  require('./members.ipc')(register, envelope);
  require('./sources.ipc')(register, envelope);
  require('./items.ipc')(register, envelope);
  require('./tags.ipc')(register, envelope);
  require('./vouchervision.ipc')(register, envelope);
  require('./assessments.ipc')(register, envelope);
  require('./gbif.ipc')(register, envelope);
  require('./settings.ipc')(register, envelope);
  require('./admin.ipc')(register, envelope);
  require('./updater.ipc')(register, envelope);
}

module.exports = { registerAll };
