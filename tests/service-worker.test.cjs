const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../service-worker.js'), 'utf8');
const base = 'https://example.com/otra-ruta/';
const urlOf = request => typeof request === 'string' ? request : request.url;

function setup(scope = base) {
  const listeners = new Map();
  const stores = new Map();
  const precached = [];
  let network = async () => { throw new Error('offline'); };
  const caches = {
    keys: async () => [...stores.keys()],
    delete: async name => stores.delete(name),
    open: async name => {
      if (!stores.has(name)) stores.set(name, new Map());
      const entries = stores.get(name);
      return {
        addAll: async urls => {
          for (const url of urls) {
            precached.push(String(url));
            entries.set(String(url), new Response('precache'));
          }
        },
        put: async (request, response) => entries.set(urlOf(request), response),
        match: async request => entries.get(urlOf(request))?.clone(),
      };
    },
    match: async request => {
      for (const entries of stores.values()) {
        const response = entries.get(urlOf(request));
        if (response) return response.clone();
      }
    },
  };
  const context = {
    URL, Response, Request, caches,
    fetch: request => network(request),
    self: {
      location: new URL(`${scope}service-worker.js`),
      registration: { scope },
      addEventListener: (type, callback) => listeners.set(type, callback),
      skipWaiting() {},
      clients: { claim: async () => {} },
    },
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  async function dispatch(type, request) {
    const pending = [];
    let response;
    listeners.get(type)({
      request,
      waitUntil: promise => pending.push(promise),
      respondWith: promise => { response = promise; },
    });
    const result = await response;
    await Promise.all(pending);
    return result;
  }
  return { stores, caches, precached, dispatch, network: handler => { network = handler; } };
}

test('instalar precarga HTML, código y estilos usando la ruta real de despliegue', async () => {
  const h = setup();
  await h.dispatch('install');
  for (const relative of ['index.html', 'js/app.js', 'js/auth.js', 'js/sync.js', 'js/modules/menu.js', 'css/main.css']) {
    assert.equal(h.precached.includes(`${base}${relative}`), true, relative);
  }
  assert.equal(h.precached.every(url => url.startsWith(base)), true);
});

test('todas las rutas de precarga existen para que la instalación no falle por un 404', async () => {
  const h = setup();
  await h.dispatch('install');
  for (const url of h.precached) {
    const relative = new URL(url).pathname.slice(new URL(base).pathname.length) || 'index.html';
    assert.equal(fs.statSync(path.join(__dirname, '..', relative)).isFile(), true, relative);
  }
});

test('activar elimina versiones previas de MenuApp y conserva cachés de otras apps', async () => {
  const h = setup();
  h.stores.set('menuapp-v1', new Map());
  h.stores.set('otra-app-v1', new Map());
  await h.dispatch('install');
  await h.dispatch('activate');
  assert.equal(h.stores.has('menuapp-v1'), false);
  assert.equal(h.stores.has('otra-app-v1'), true);
  assert.equal([...h.stores.keys()].filter(name => name.startsWith('menuapp-')).length, 1);
});

test('los recursos instalados siguen disponibles offline sin haber visitado cada vista', async () => {
  const h = setup();
  await h.dispatch('install');
  const response = await h.dispatch('fetch', new Request(`${base}js/modules/menu.js`));
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'precache');
});

test('una respuesta nueva de red reemplaza la caché y se conserva para offline', async () => {
  const h = setup();
  await h.dispatch('install');
  h.network(async () => new Response('latest'));
  const request = new Request(`${base}js/app.js`);
  const online = await h.dispatch('fetch', request);
  assert.equal(await online.text(), 'latest');
  h.network(async () => { throw new Error('offline'); });
  const offline = await h.dispatch('fetch', request);
  assert.equal(await offline.text(), 'latest');
});

test('una respuesta HTTP de error no reemplaza la copia válida para offline', async () => {
  const h = setup();
  await h.dispatch('install');
  h.network(async () => new Response('unavailable', { status: 503 }));
  const request = new Request(`${base}js/app.js`);
  assert.equal((await h.dispatch('fetch', request)).status, 503);
  h.network(async () => { throw new Error('offline'); });
  assert.equal(await (await h.dispatch('fetch', request)).text(), 'precache');
});

test('la navegación offline usa index y un recurso inexistente devuelve HTTP 503', async () => {
  const h = setup();
  await h.dispatch('install');
  const navigation = { method: 'GET', url: `${base}pantalla`, mode: 'navigate' };
  assert.equal((await h.dispatch('fetch', navigation)).status, 200);
  assert.equal((await h.dispatch('fetch', new Request(`${base}no-existe.js`))).status, 503);
});

test('el worker no intercepta POST, otros orígenes ni rutas fuera de la aplicación', async () => {
  const h = setup();
  const requests = [
    new Request(`${base}api`, { method: 'POST' }),
    new Request('https://accounts.google.com/gsi/client'),
    new Request('https://example.com/otra-app/index.html'),
    new Request('https://example.com/otra-ruta-externa/app.js'),
  ];
  for (const request of requests) {
    assert.equal(await h.dispatch('fetch', request), undefined);
  }
});

test('el service worker nunca intercepta ni almacena respuestas de autenticación', async () => {
  const h = setup('https://example.com/');
  for (const name of ['session','callback?code=secret','login','logout']) {
    const res = await h.dispatch('fetch', new Request('https://example.com/auth/' + name));
    assert.equal(res, undefined);
  }
});
