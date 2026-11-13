const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../js/sync.js'), 'utf8');
const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function events() {
  const listeners = new Map();
  return {
    visibilityState: 'visible',
    addEventListener(name, callback) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(callback);
    },
    removeEventListener(name, callback) { listeners.get(name)?.delete(callback); },
    emit(name) { return Promise.all([...(listeners.get(name) || [])].map(callback => callback())); },
    count(name) { return listeners.get(name)?.size || 0; },
  };
}

function setup(options = {}) {
  const cache = new Map();
  const remote = new Map(Object.entries(options.remote || {}));
  const local = new Map();
  if (options.pending) local.set('menuapp_sync_pendientes', JSON.stringify(options.pending));
  const writes = [];
  const reads = [];
  const toasts = [];
  const timers = new Map();
  const document = events();
  const window = events();
  const state = {};
  let timerId = 0;
  const context = {
    console: { log() {}, warn() {} },
    navigator: { onLine: options.online !== false },
    document, window,
    localStorage: { getItem: key => local.get(key) || null, setItem: (key, value) => local.set(key, value) },
    Storage: {
      set: async (key, data) => { cache.set(key, copy(data)); },
      get: async key => copy(cache.get(key)),
    },
    Auth: { isAuthenticated: () => options.authenticated !== false },
    App: { getState: () => state },
    UI: { showToast: (...args) => toasts.push(args) },
    Drive: {
      getFolderIds: () => ({ rootFolderId: options.rootReady === false ? null : 'root' }),
      writeJson: async (name, data) => { writes.push({ name, data: copy(data) }); remote.set(name, copy(data)); },
      writeMenuJson: async (name, data) => { writes.push({ name: `menus/${name}`, data: copy(data) }); },
      readJson: async name => { reads.push(name); return copy(remote.get(name) || null); },
      hasChanged: async () => false,
      listRootJsonFiles: async () => [],
      listPurchaseFiles: async () => [],
    },
    setTimeout: callback => { timers.set(++timerId, callback); return timerId; },
    clearTimeout: id => timers.delete(id),
  };
  vm.createContext(context);
  vm.runInContext(`${source}\nthis.Sync = Sync;`, context);
  return { ...context, cache, remote, local, writes, reads, toasts, timers, state };
}

const item = (cantidad, actualizadoEn, extra = {}) => ({
  id: 'leche', nombre: 'Leche', cantidad, actualizadoEn, comprado: false, noDisponible: false, ...extra,
});
const at = hour => `2026-11-13T${hour}:00:00.000Z`;

test('una reducción explícita reciente conserva cantidad y timestamp en ambos órdenes', () => {
  const { Sync } = setup();
  const old = { items: [item(5, at('10'))] };
  const recent = { items: [item(4, at('11'))] };
  for (const pair of [[old, recent], [recent, old]]) {
    const result = Sync.mergeCompras(...pair).items[0];
    assert.equal(result.cantidad, 4);
    assert.equal(result.actualizadoEn, at('11'));
  }
});

test('sin timestamps y con timestamps iguales se mantiene la cantidad máxima', () => {
  const { Sync } = setup();
  for (const timestamp of [undefined, at('10')]) {
    assert.equal(Sync.mergeCompras({ items: [item(5, timestamp)] }, { items: [item(4, timestamp)] }).items[0].cantidad, 5);
  }
});

test('todos los campos de la versión reciente sobreviven a merges antiguos sucesivos', () => {
  const { Sync } = setup();
  const newest = { items: [item(2, at('12'), { comprado: true, unidad: 'l', supermercadoId: 'nuevo' })] };
  const oldest = { items: [item(1, at('10'), { unidad: 'ud', supermercadoId: 'viejo' })] };
  const merged = Sync.mergeCompras(newest, oldest);
  const result = Sync.mergeCompras(merged, { items: [item(3, at('11'))] }).items[0];
  assert.equal(result.comprado, true);
  assert.equal(result.actualizadoEn, at('12'));
  assert.equal(result.unidad, 'l');
  assert.equal(result.supermercadoId, 'nuevo');
});

test('la retirada más reciente gana en ambos órdenes y no resucita el artículo antiguo', () => {
  const { Sync } = setup();
  const recent = { removidos: { leche: at('12') }, items: [] };
  const old = { removidos: { leche: at('10') }, items: [item(1, at('11'))] };
  for (const pair of [[recent, old], [old, recent]]) {
    const merged = Sync.mergeCompras(...pair);
    assert.equal(merged.items.length, 0);
    assert.equal(merged.removidos.leche, at('12'));
  }
});

test('reincorporar después de una retirada conserva la marca y rechaza otras copias antiguas', () => {
  const { Sync } = setup();
  const removed = { removidos: { leche: at('11') }, items: [item(8, at('10'))] };
  const added = { items: [item(2, at('12'))] };
  for (const pair of [[removed, added], [added, removed]]) {
    const merged = Sync.mergeCompras(...pair);
    assert.equal(merged.items[0].cantidad, 2);
    assert.equal(merged.removidos.leche, at('11'));
    assert.equal(Sync.mergeCompras(merged, removed).items[0].cantidad, 2);
  }
});

test('save captura el dato y persiste el pendiente antes de cualquier espera', async () => {
  const h = setup({ online: false });
  const data = [{ nombre: 'Leche', cantidad: 2 }];
  const saving = h.Sync.save('inventario.json', data);
  data[0].cantidad = 99;
  assert.equal(JSON.parse(h.local.get('menuapp_sync_pendientes'))['inventario.json'].data[0].cantidad, 2);
  await saving;
  assert.equal(h.cache.get('cache_inventario.json')[0].cantidad, 2);
  const pending = h.Sync.getPendingData('inventario.json');
  pending[0].cantidad = 66;
  assert.equal(h.Sync.getPendingData('inventario.json')[0].cantidad, 2);
});

test('las subidas del mismo fichero se serializan y un éxito antiguo no borra el fallo reciente', async () => {
  const h = setup();
  const first = deferred();
  const calls = [];
  h.Drive.writeJson = async (name, data) => {
    calls.push(data.version);
    if (data.version === 1) await first.promise;
    else throw new Error('network');
  };
  const a = h.Sync.save('inventario.json', { version: 1 });
  await flush();
  const b = h.Sync.save('inventario.json', { version: 2 });
  await flush();
  assert.deepEqual(calls, [1]);
  first.resolve();
  await Promise.all([a, b]);
  assert.deepEqual(calls, [1, 2]);
  assert.equal(h.Sync.getPendingData('inventario.json').version, 2);
  assert.equal(h.cache.get('cache_inventario.json').version, 2);
});

test('una petición lenta no bloquea las escrituras de otro fichero', async () => {
  const h = setup();
  const slow = deferred();
  h.Drive.writeJson = async name => { if (name === 'inventario.json') await slow.promise; };
  const inventory = h.Sync.save('inventario.json', []);
  await flush();
  await h.Sync.save('platos.json', []);
  assert.equal(h.Sync.isPending('platos.json'), false);
  assert.equal(h.Sync.isPending('inventario.json'), true);
  slow.resolve();
  await inventory;
});

test('start recupera y sube pendientes de la sesión anterior, sin duplicar listeners', async () => {
  const h = setup({ pending: { 'inventario.json': { data: [{ nombre: 'Leche' }], ts: 1 } } });
  assert.equal(h.Sync.getPendingData('inventario.json')[0].nombre, 'Leche');
  await h.Sync.start();
  await h.Sync.start();
  assert.equal(h.writes.length, 1);
  assert.equal(h.Sync.isPending('inventario.json'), false);
  assert.equal(h.document.count('visibilitychange'), 1);
  assert.equal(h.window.count('online'), 1);
  assert.equal(h.timers.size, 1);
  h.Sync.stop();
  assert.equal(h.document.count('visibilitychange'), 0);
  assert.equal(h.window.count('online'), 0);
  assert.equal(h.timers.size, 0);
});

test('el polling reintenta los pendientes y no descarga archivos cuyo envío falla', async () => {
  const h = setup({ pending: { 'inventario.json': { data: { version: 2 }, ts: 1 } }, remote: { 'inventario.json': { version: 1 } } });
  h.Drive.writeJson = async () => { throw new Error('network'); };
  await h.Sync.start();
  await h.Sync.syncNow();
  assert.equal(h.Sync.getPendingData('inventario.json').version, 2);
  assert.equal(h.reads.includes('inventario.json'), false);
  assert.equal(h.toasts.at(-1)[1], 'warning');
  h.Drive.writeJson = async () => {};
  await h.Sync.syncNow({ silent: true });
  assert.equal(h.Sync.isPending('inventario.json'), false);
  h.Sync.stop();
});

test('una descarga en curso no reemplaza una edición local posterior ya subida', async () => {
  const h = setup();
  const download = deferred();
  h.Drive.readJson = async name => name === 'inventario.json' ? download.promise : null;
  const syncing = h.Sync.syncNow({ silent: true });
  await flush();
  h.state.inventario = { version: 2 };
  await h.Sync.save('inventario.json', { version: 2 });
  download.resolve({ version: 1 });
  await syncing;
  assert.equal(h.cache.get('cache_inventario.json').version, 2);
  assert.equal(h.state.inventario.version, 2);
});

test('start no usa Drive antes de inicializar las carpetas y syncNow sí reintenta después', async () => {
  const h = setup({ rootReady: false, pending: { 'inventario.json': { data: [], ts: 1 } } });
  await h.Sync.start();
  assert.equal(h.writes.length, 0);
  h.Drive.getFolderIds = () => ({ rootFolderId: 'root' });
  await h.Sync.syncNow({ silent: true });
  assert.equal(h.writes.length, 1);
  assert.equal(h.toasts.length, 0);
  h.Sync.stop();
});

test('la compra se guarda únicamente mediante saveCompra explícito y conserva la reducción', async () => {
  const old = { items: [item(5, at('10'))] };
  const h = setup({ remote: { 'lista_compra.json': old } });
  await h.Sync.start();
  assert.equal(h.writes.length, 0);
  const result = await h.Sync.saveCompra({ items: [item(4, at('11'))] });
  assert.equal(result.items[0].cantidad, 4);
  assert.equal(h.remote.get('lista_compra.json').items[0].cantidad, 4);
  assert.equal(h.Sync.isPending('lista_compra.json'), false);
  h.Sync.stop();
});

test('una compra pendiente offline se combina con Drive al recuperar conexión', async () => {
  const h = setup({ online: false, remote: { 'lista_compra.json': { items: [item(5, at('10'))] } } });
  await h.Sync.start();
  await h.Sync.saveCompra({ items: [item(4, at('11'))] });
  assert.equal(h.writes.length, 0);
  h.navigator.onLine = true;
  await h.window.emit('online');
  assert.equal(h.remote.get('lista_compra.json').items[0].cantidad, 4);
  assert.equal(h.Sync.isPending('lista_compra.json'), false);
  h.Sync.stop();
});

test('saveMenu y su reintento usan la carpeta de menús', async () => {
  const h = setup({ online: false });
  await h.Sync.saveMenu({ fechaInicio: '2026-11-13', dias: [] });
  assert.equal(h.Sync.isPending('menus/semana_20261113.json'), true);
  h.navigator.onLine = true;
  await h.Sync.syncNow({ silent: true });
  assert.equal(h.writes[0].name, 'menus/semana_20261113.json');
  assert.equal(h.Sync.isPending('menus/semana_20261113.json'), false);
});

test('syncNow no anuncia éxito sin conexión ni cuando falla una descarga', async () => {
  const offline = setup({ online: false });
  assert.equal(await offline.Sync.syncNow(), false);
  assert.equal(offline.toasts.at(-1)[1], 'warning');
  const h = setup();
  h.Drive.readJson = async () => { throw new Error('network'); };
  assert.equal(await h.Sync.syncNow(), false);
  assert.equal(h.toasts.at(-1)[1], 'warning');
});

test('una sincronización forzada espera al poll en curso y luego fuerza su descarga', async () => {
  const h = setup({ remote: { 'inventario.json': { version: 1 } } });
  const checking = deferred();
  h.Drive.hasChanged = async () => checking.promise;
  const initial = h.Sync.start();
  await flush();
  const forced = h.Sync.syncNow({ silent: true });
  checking.resolve(false);
  await Promise.all([initial, forced]);
  assert.equal(h.state.inventario.version, 1);
  h.Sync.stop();
});
