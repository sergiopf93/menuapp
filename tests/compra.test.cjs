const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../js/modules/compra.js'), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function setup(options = {}) {
  const current = { items: [{ id: 'leche', nombre: 'Leche', cantidad: 2, comprado: false }], removidos: {} };
  const state = { compraActual: current, catalogo: [], config: { supermercados: [] } };
  const view = { innerHTML: '' };
  const local = new Map();
  let reads = 0;
  let merges = 0;
  const context = {
    console: { warn() {} },
    App: { getState: () => state },
    document: {
      getElementById: id => id === 'view-compra' ? view : null,
      querySelectorAll: () => [],
    },
    localStorage: {
      getItem: key => local.get(key) || null,
      setItem: (key, value) => local.set(key, value),
    },
    Dates: { today: () => '2026-11-13', format: value => value },
    Drive: {
      getFolderIds: () => ({ menusFolderId: 'menus' }),
      listMenuFiles: async () => options.menuFiles ? options.menuFiles() : [],
      readMenuJson: async () => null,
    },
    Sync: {
      readCompra: async () => { reads++; return options.readCompra ? options.readCompra() : null; },
      mergeCompras: (remote, current) => { merges++; return remote || current; },
    },
    UI: { escapeHtml: value => value || '' },
  };
  const instrumented = source.replace(/return \{ render(?:, refresh)? \};/, `return {
    render, refresh: typeof refresh === 'function' ? refresh : undefined,
    setView: name => { _vista=name; _renderVista(); },
    getView: () => _vista,
    getCurrent: () => _compraActual,
    initialize: value => { _compraActual=value; },
  };`);
  vm.createContext(context);
  vm.runInContext(`${instrumented}\nthis.Compra = Compra;`, context);
  context.Compra.initialize(current);
  return { ...context, state, view, local, reads: () => reads, merges: () => merges };
}

test('refresh de datos conserva selección de supermercado y modo compra sin reiniciar la lista', () => {
  const h = setup();
  for (const mode of ['seleccion-super', 'modo-compra']) {
    h.Compra.setView(mode);
    const html = h.view.innerHTML;
    const current = h.Compra.getCurrent();
    h.Compra.refresh();
    assert.equal(h.Compra.getView(), mode);
    assert.equal(h.view.innerHTML, html);
    assert.equal(h.Compra.getCurrent(), current);
    assert.equal(h.reads(), 0);
  }
});

test('resolver una búsqueda de menú antigua no sustituye modo compra ni continúa leyendo la lista', async () => {
  const waiting = deferred();
  const h = setup({ menuFiles: () => waiting.promise });
  h.Compra.render();
  h.Compra.setView('modo-compra');
  const html = h.view.innerHTML;
  waiting.resolve([]);
  await flush();
  assert.equal(h.view.innerHTML, html);
  assert.equal(h.Compra.getView(), 'modo-compra');
  assert.equal(h.reads(), 0);
  assert.equal(h.local.size, 0);
});

test('resolver una lectura antigua de compra no modifica el modo ni sus datos actuales', async () => {
  const waiting = deferred();
  const h = setup({ readCompra: () => waiting.promise });
  h.Compra.render();
  await flush();
  assert.equal(h.reads(), 1);
  h.Compra.setView('modo-compra');
  const html = h.view.innerHTML;
  const current = h.Compra.getCurrent();
  waiting.resolve({ items: [{ id: 'remoto', nombre: 'Antiguo' }], removidos: {} });
  await flush();
  assert.equal(h.view.innerHTML, html);
  assert.equal(h.Compra.getCurrent(), current);
  assert.equal(h.merges(), 0);
  assert.equal(h.local.size, 0);
});

test('entre dos renders de lista prevalece el más reciente aunque la primera respuesta llegue después', async () => {
  const first = deferred();
  let count = 0;
  const h = setup({ readCompra: () => ++count === 1 ? first.promise : { items: [], removidos: {}, marker: 'new' } });
  h.Compra.render();
  await flush();
  h.Compra.refresh();
  await flush();
  assert.equal(h.Compra.getCurrent().marker, 'new');
  const html = h.view.innerHTML;
  first.resolve({ items: [], removidos: {}, marker: 'old' });
  await flush();
  assert.equal(h.Compra.getCurrent().marker, 'new');
  assert.equal(h.view.innerHTML, html);
});
