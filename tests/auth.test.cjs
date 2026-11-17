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

function serverSetup(session) {
  const stored = new Map(session ? [['auth_session', session]] : []);
  const calls = [];
  let handler = async () => Response.json({ accessToken: 'server-access', tokenExpiry: Date.now() + 3600000,
    userInfo: { ...user, sub: 'google-user' } });
  const context = {
    MENUAPP_SERVER_AUTH: true, AbortSignal, navigator: { onLine: true },
    Storage: { get: async k => stored.get(k), set: async (k,v) => stored.set(k,v), remove: async k => stored.delete(k) },
    fetch: async (...args) => { calls.push(args); return handler(...args); },
    document: { createElement: () => ({ submit() { calls.push(['submit']); } }), body: { appendChild() {} } },
  };
  vm.createContext(context);
  vm.runInContext(`${source}\nthis.Auth=Auth;`, context);
  return { ...context, calls, stored, handle: fn => { handler = fn; } };
}

test('servidor restaura automáticamente sin SDK, popup ni token persistido', async () => {
  const h = serverSetup({ accessToken: 'old', tokenExpiry: Date.now() + 3600000, userInfo: user });
  await h.Auth.init();
  assert.equal(await h.Auth.tryRestoreSession(), false);
  assert.equal(await h.Auth.ensureAccessToken(), 'server-access');
  assert.equal(h.calls[0][0], '/auth/session');
  assert.equal(h.calls[0][1].credentials, 'same-origin');
  assert.equal(h.calls[0][1].cache, 'no-store');
  assert.deepEqual(Object.keys(h.stored.get('auth_session')), ['userInfo']);
});

test('peticiones concurrentes comparten la renovación y reutilizan acceso vigente', async () => {
  const h = serverSetup();
  const tokens = await Promise.all([h.Auth.ensureAccessToken(),h.Auth.ensureAccessToken(),h.Auth.ensureAccessToken()]);
  assert.deepEqual(tokens, ['server-access','server-access','server-access']);
  assert.equal(h.calls.length, 1);
  await h.Auth.ensureAccessToken();
  assert.equal(h.calls.length, 1);
});

test('sin conexión conserva el perfil y no intenta abrir Google', async () => {
  const h = serverSetup({ userInfo: user }); h.navigator.onLine = false;
  await h.Auth.tryRestoreSession();
  assert.equal(await h.Auth.ensureAccessToken(), null);
  assert.equal(h.Auth.getUserInfo().email, user.email);
  assert.equal(h.calls.length, 0);
});

test('error temporal permite reintentar y 401 no inicia login automático', async () => {
  const h = serverSetup();
  h.handle(async () => Response.json({}, { status: 503 }));
  await assert.rejects(h.Auth.ensureAccessToken(), /renovar/);
  h.handle(async () => Response.json({}, { status: 401 }));
  assert.equal(await h.Auth.ensureAccessToken(), null);
  assert.equal(h.calls.length, 2);
  assert.equal(await h.Auth.login(), false);
  assert.equal(h.calls.at(-1)[0], 'submit');
});

test('respuesta de renovación tardía no resucita una sesión cerrada', async () => {
  const h = serverSetup(); let release;
  h.handle(async path => path === '/auth/logout' ? Response.json({ ok: true })
    : new Promise(resolve => { release = () => resolve(Response.json({ accessToken: 'late', tokenExpiry: Date.now() + 3600000, userInfo: { ...user, sub: 'user' } })); }));
  const pending = h.Auth.ensureAccessToken();
  await h.Auth.logout(); release();
  assert.equal(await pending, null);
  assert.equal(h.Auth.getAccessToken(), null);
  assert.equal(await h.Auth.ensureAccessToken(), null);
  assert.equal(h.stored.has('auth_session'), false);
});

test('logout fallido no afirma cerrar la sesión y permite reintentar', async () => {
  const h = serverSetup();
  await h.Auth.ensureAccessToken();
  h.handle(async () => Response.json({}, { status: 503 }));
  await assert.rejects(h.Auth.logout(), /cerrar/);
  assert.equal(h.Auth.isAuthenticated(), true);
});
