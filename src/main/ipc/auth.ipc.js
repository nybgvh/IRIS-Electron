const { ipcMain } = require('electron');
const authService = require('../../server/services/auth-service');
const { AppError } = require('../../server/errors');

function publicError(err) {
  if (err instanceof AppError) return { code: err.code, message: err.message };
  console.error('[auth.ipc] unexpected error:', err);
  return { code: 'app/error', message: 'An unexpected error occurred.' };
}

/*
 * Auth handlers are special — login does not take a token, and `me`/`logout`
 * read the token directly without going through the auth-required wrapper.
 * So they're registered here against ipcMain.handle directly rather than
 * through the shared `envelope` helper.
 */
module.exports = (_register, _envelope) => {
  ipcMain.handle('auth:login', async (_e, credentials) => {
    try {
      const data = await authService.login(credentials || {});
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: publicError(err) };
    }
  });

  ipcMain.handle('auth:logout', async (_e, token) => {
    try {
      const data = authService.logout(token);
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: publicError(err) };
    }
  });

  ipcMain.handle('auth:me', async (_e, token) => {
    try {
      const data = authService.me(token);
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: publicError(err) };
    }
  });
};
