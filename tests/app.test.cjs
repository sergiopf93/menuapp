const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../js/app.js'), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));

function setup(options = {}) {
  const screens = [];
  const views = [];
  const calls = [];
  const syncOptions = [];
  const toasts = [];
  const fileListeners = new Map();
  const listeners = new Map();
  const button = {
    style: {}, disabled: false,
    setAttribute() {},
    addEventListener: (event, handler) => listeners.set(event, handler),
  };
  const status = { innerHTML: '' };
  let authenticated = options.authenticated || false;
  const context = {
    console: { log() {}, warn() {}, error() {} },
    navigator: { onLine: options.online !== false },
    document: {
      getElementById: id => id === 'btn-sync' ? button
        : id === 'drive-status-text' && options.status ? status : null,
      querySelector: () => options.activeView ? { id: `view-${options.activeView}` } : null,
      addEventListener() {},
    },
    window: { addEventListener() {} },
    UI: {
      showScreen: screen => screens.push(screen),
      activateView: view => views.push(view),
      maybeShowPWABanner() {},
      showToast: (...args) => toasts.push(args),
      escapeHtml: value => value || '',
    },
    Storage: { get: async name => options.cache?.[name] || null },
    Auth: {
      tryRestoreSession: async () => { calls.push('restore'); },
      getUserInfo: () => options.user || null,
      isAuthenticated: () => authenticated,
      init: () => { calls.push('sdk'); return options.sdk || Promise.resolve(); },
      login: async () => { calls.push('login'); authenticated = true; },
    },
    Sync: {
      getPendingData: name => options.pending?.[name] || null,
      start: () => calls.push('start'),
      onFileChange: (name, callback) => fileListeners.set(name, callback),
      syncNow: async config => {
        calls.push('sync');
        syncOptions.push(config);
        return options.syncResult !== false;
      },
    },
    Drive: {
      initFolderStructure: async () => { calls.push('drive'); },
      getFolderIds: () => ({ rootFolderId: 'root' }),
    },
    Notificaciones: { init() {} },
    Compra: {
      render: () => calls.push('compra-render'),
      refresh: () => calls.push('compra-refresh'),
    },
  };
  vm.createContext(context);
  vm.runInContext(`${source}\nthis.App = App;`, context);
  return { ...context, screens, views, calls, fileListeners, syncOptions, status, toasts, button, clickSync: () => listeners.get('click')() };
}

test('abre Inicio con datos por defecto sin esperar a un SDK que nunca carga', async () => {
  const h = setup({ sdk: new Promise(() => {}) });
  await h.App.boot();
  assert.deepEqual(h.screens, ['loading', 'app']);
  assert.deepEqual(h.views, ['dashboard']);
  assert.equal(h.App.getState().config.personas.length, 3);
  assert.equal(h.App.getState().inventario.length, 0);
  assert.equal(h.calls.includes('login'), false);
  assert.equal(h.calls.includes('drive'), false);
});

test('los datos locales pendientes prevalecen sobre una caché anterior, incluso una lista vacía', async () => {
  const h = setup({
    cache: { 'cache_inventario.json': [{ nombre: 'Antiguo' }], 'cache_platos.json': [{ nombre: 'Eliminado' }] },
    pending: { 'inventario.json': [{ nombre: 'Local nuevo' }], 'platos.json': [] },
  });
  await h.App.boot();
  assert.equal(h.App.getState().inventario[0].nombre, 'Local nuevo');
  assert.equal(h.App.getState().platos.length, 0);
});

test('una sesión vigente sincroniza después de abrir Inicio sin pedir login', async () => {
  const h = setup({ authenticated: true, sdk: new Promise(() => {}) });
  await h.App.boot();
  await flush();
  assert.equal(h.screens.at(-1), 'app');
  assert.equal(h.calls.includes('login'), false);
  assert.equal(h.calls.includes('drive'), true);
  assert.equal(h.calls.includes('sync'), true);
});

test('offline permite abrir Inicio y pulsar sincronizar sin iniciar OAuth', async () => {
  const h = setup({ online: false });
  await h.App.boot();
  await h.clickSync();
  assert.equal(h.calls.includes('login'), false);
  assert.equal(h.calls.includes('drive'), false);
  assert.match(h.toasts.at(-1)[0], /datos locales/);
  assert.equal(h.button.disabled, false);
});

test('conectar es una acción explícita y las pulsaciones concurrentes no duplican OAuth', async () => {
  let resolveSDK;
  const sdk = new Promise(resolve => { resolveSDK = resolve; });
  const h = setup({ sdk });
  await h.App.boot();
  const first = h.clickSync();
  const second = h.clickSync();
  resolveSDK();
  await Promise.all([first, second]);
  assert.equal(h.calls.filter(call => call === 'login').length, 1);
  assert.equal(h.calls.filter(call => call === 'drive').length, 1);
  assert.equal(h.button.disabled, false);
});

test('un error de autorización se muestra y libera el botón para reconectar', async () => {
  const h = setup();
  await h.App.boot();
  h.Auth.login = async () => { throw new Error('Se ha cerrado la conexión con Google.'); };
  await h.clickSync();
  assert.equal(h.button.disabled, false);
  assert.equal(h.calls.includes('drive'), false);
  assert.match(h.toasts.at(-1)[0], /cerrado/);
  let retried = false;
  h.Auth.login = async () => { retried = true; };
  await h.clickSync();
  assert.equal(retried, true);
});

test('la sincronización al arrancar es silenciosa y la acción del usuario muestra su resultado', async () => {
  const h = setup({ authenticated: true });
  await h.App.boot();
  await flush();
  assert.equal(h.syncOptions.length, 1);
  assert.equal(h.syncOptions[0].silent, true);
  await h.clickSync();
  assert.equal(h.syncOptions.length, 2);
  assert.equal(h.syncOptions[1].silent, false);
});

test('un resultado de sincronización incompleto no muestra un estado de éxito en Drive', async () => {
  const h = setup({ syncResult: false, status: true });
  await h.App.boot();
  await h.clickSync();
  assert.equal(h.syncOptions[0].silent, false);
  assert.doesNotMatch(h.status.innerHTML, /status-ok/);
  assert.doesNotMatch(h.status.innerHTML, /✓ Google Drive conectado/);
  assert.equal(h.button.disabled, false);
});

test('los cambios remotos refrescan Compra sin volver a abrir el flujo de lista', async () => {
  const h = setup({ activeView: 'compra' });
  await h.App.boot();
  h.fileListeners.get('catalogo.json')([{ nombre: 'Nuevo artículo' }]);
  assert.equal(h.App.getState().catalogo[0].nombre, 'Nuevo artículo');
  assert.equal(h.calls.filter(call => call === 'compra-refresh').length, 1);
  assert.equal(h.calls.includes('compra-render'), false);
});
