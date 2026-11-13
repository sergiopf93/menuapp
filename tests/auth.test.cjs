const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../js/auth.js'), 'utf8');
const user = { name: 'Ana', email: 'ana@example.com' };

function setup(session) {
  const scripts = [];
  const stored = new Map(session ? [['auth_session', session]] : []);
  const tokenClient = { requestAccessToken() {} };
  let tokenConfig;
  const context = {
    document: {
      createElement: () => ({}),
      head: { appendChild: script => scripts.push(script) },
    },
    Storage: {
      get: async key => stored.get(key),
      set: async (key, data) => stored.set(key, data),
      remove: async key => stored.delete(key),
    },
    fetch: async () => ({ ok: true, json: async () => user }),
  };
  vm.createContext(context);
  vm.runInContext(`${source}\nthis.Auth = Auth;`, context);
  function loadSDK() {
    context.google = { accounts: { oauth2: {
      initTokenClient: options => {
        tokenConfig = options;
        tokenClient.callback = options.callback;
        return tokenClient;
      },
      revoke() {},
    } } };
    scripts.at(-1).onload();
  }
  return { ...context, context, stored, scripts, tokenClient, loadSDK, popupError: error => tokenConfig.error_callback(error) };
}

test('restaura un token vigente y el perfil sin cargar el SDK', async () => {
  const h = setup({ accessToken: 'valid', tokenExpiry: Date.now() + 3600000, userInfo: user });
  assert.equal(await h.Auth.tryRestoreSession(), true);
  assert.equal(h.Auth.getAccessToken(), 'valid');
  assert.equal(h.Auth.getUserInfo().email, user.email);
  assert.equal(h.scripts.length, 0);
});

test('un token caducado mantiene el perfil y requiere reconectar', async () => {
  const h = setup({ accessToken: 'expired', tokenExpiry: Date.now() - 1, userInfo: user });
  assert.equal(await h.Auth.tryRestoreSession(), false);
  assert.equal(h.Auth.isAuthenticated(), false);
  assert.equal(h.Auth.getUserInfo().email, user.email);
});

test('no usa un token que caduca en menos de un minuto', async () => {
  const h = setup({ accessToken: 'almost-expired', tokenExpiry: Date.now() + 30000, userInfo: user });
  assert.equal(await h.Auth.tryRestoreSession(), false);
  assert.equal(h.Auth.getAccessToken(), null);
});

test('init comparte una carga concurrente y no duplica el SDK una vez listo', async () => {
  const h = setup();
  const first = h.Auth.init();
  const second = h.Auth.init();
  assert.equal(h.scripts.length, 1);
  h.loadSDK();
  await Promise.all([first, second]);
  await h.Auth.init();
  assert.equal(h.scripts.length, 1);
});

test('init permite reintentar después de un fallo cargando el SDK', async () => {
  const h = setup();
  const first = h.Auth.init();
  h.scripts[0].onerror();
  await assert.rejects(first, /No se pudo cargar/);
  const second = h.Auth.init();
  assert.equal(h.scripts.length, 2);
  h.loadSDK();
  await second;
});

test('cerrar el popup rechaza el login y permite intentar de nuevo', async () => {
  const h = setup();
  const initializing = h.Auth.init();
  h.loadSDK();
  await initializing;
  const login = h.Auth.login();
  h.popupError({ type: 'popup_closed' });
  await assert.rejects(login, /cerrado/);
  const retry = h.Auth.login();
  await h.tokenClient.callback({ access_token: 'new-token', expires_in: 3600 });
  await retry;
  assert.equal(h.Auth.getAccessToken(), 'new-token');
  assert.equal(h.stored.get('auth_session').userInfo.email, user.email);
});

test('un error OAuth no crea una sesión autenticada', async () => {
  const h = setup();
  const initializing = h.Auth.init();
  h.loadSDK();
  await initializing;
  const login = h.Auth.login();
  await h.tokenClient.callback({ error: 'access_denied' });
  await assert.rejects(login, /access_denied/);
  assert.equal(h.Auth.isAuthenticated(), false);
  assert.equal(h.stored.has('auth_session'), false);
});

test('cerrar una sesión restaurada limpia el dispositivo aunque el SDK no esté disponible', async () => {
  const h = setup({ accessToken: 'valid', tokenExpiry: Date.now() + 3600000, userInfo: user });
  await h.Auth.tryRestoreSession();
  await h.Auth.logout();
  assert.equal(h.Auth.getAccessToken(), null);
  assert.equal(h.Auth.getUserInfo(), null);
  assert.equal(h.stored.has('auth_session'), false);
});
