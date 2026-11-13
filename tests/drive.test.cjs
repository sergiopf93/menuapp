const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../js/drive.js'), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
const json = (data, status = 200) => new Response(JSON.stringify(data), { status });

function setup() {
  const calls = [];
  const saved = new Map();
  let handler = async url => {
    const query = new URL(url).searchParams.get('q');
    if (query?.includes('application/vnd.google-apps.folder')) {
      const name = query.match(/name='([^']+)'/)[1];
      return json({ files: [{ id: `${name}-id` }] });
    }
    return json({ files: [] });
  };
  const context = {
    Blob, FormData, URLSearchParams,
    Auth: { getAccessToken: () => 'token' },
    UI: { setLoadingMessage() {} },
    Storage: { set: async (key, value) => saved.set(key, value) },
    fetch: async (url, options = {}) => {
      calls.push({ url, options });
      return handler(url, options);
    },
  };
  vm.createContext(context);
  vm.runInContext(`${source}\nthis.Drive = Drive;`, context);
  return { ...context, calls, saved, handle: fn => { handler = fn; } };
}

test('inicializar Drive concurrentemente no duplica la creación de carpetas', async () => {
  const h = setup();
  const creations = [];
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  h.handle(async (url, options) => {
    if (options.method === 'POST') {
      const metadata = JSON.parse(options.body);
      creations.push(metadata);
      return json({ id: `${metadata.name}-id` });
    }
    await waiting;
    return json({ files: [] });
  });
  const first = h.Drive.initFolderStructure();
  const second = h.Drive.initFolderStructure();
  await flush();
  assert.equal(h.calls.length, 1);
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.rootId, 'MenuApp-id');
  assert.equal(b.menusId, 'menus-id');
  assert.deepEqual(creations.map(folder => folder.name).sort(), ['MenuApp', 'backups', 'compras', 'menus']);
  assert.equal(creations.filter(folder => folder.name !== 'MenuApp').every(folder => folder.parents[0] === 'MenuApp-id'), true);
  const count = h.calls.length;
  await h.Drive.initFolderStructure();
  assert.equal(h.calls.length, count);
  assert.equal(h.saved.get('drive_root_folder_id'), 'MenuApp-id');
});

test('se puede reintentar una inicialización que falla', async () => {
  const h = setup();
  h.handle(async () => json({}, 503));
  await assert.rejects(h.Drive.initFolderStructure(), /503/);
  h.handle(async () => json({ files: [{ id: 'recovered' }] }));
  const result = await h.Drive.initFolderStructure();
  assert.equal(result.rootId, 'recovered');
});

test('un error HTTP buscando un fichero no provoca crear otro ni simula ausencia al leer', async () => {
  const h = setup();
  await h.Drive.initFolderStructure();
  h.calls.length = 0;
  h.handle(async () => json({}, 503));
  await assert.rejects(h.Drive.writeJson('inventario.json', []), /503/);
  await assert.rejects(h.Drive.readJson('inventario.json'), /503/);
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls.every(call => !call.options.method || call.options.method === 'GET'), true);
});

test('una búsqueda exitosa sin resultados sí permite crear el fichero en su carpeta', async () => {
  const h = setup();
  await h.Drive.initFolderStructure();
  h.handle(async (url, options) => {
    if (options.method === 'POST') {
      const metadata = JSON.parse(await options.body.get('metadata').text());
      assert.equal(metadata.parents[0], 'MenuApp-id');
      assert.equal(metadata.name, 'inventario.json');
      return json({ id: 'new-file' });
    }
    return json({ files: [] });
  });
  assert.equal(await h.Drive.writeJson('inventario.json', []), 'new-file');
});

test('los listados de raíz, menús y compras incluyen todas las páginas', async () => {
  const h = setup();
  await h.Drive.initFolderStructure();
  const folders = [
    ['listRootJsonFiles', 'MenuApp-id'],
    ['listMenuFiles', 'menus-id'],
    ['listPurchaseFiles', 'compras-id'],
  ];
  for (const [method, folder] of folders) {
    const pages = [];
    h.handle(async url => {
      const params = new URL(url).searchParams;
      assert.match(params.get('q'), new RegExp(folder));
      assert.match(params.get('fields'), /nextPageToken/);
      pages.push(params.get('pageToken'));
      return params.has('pageToken')
        ? json({ files: [{ id: 'later' }] })
        : json({ files: [{ id: 'first' }], nextPageToken: 'page-2/+' });
    });
    const files = await h.Drive[method]();
    assert.deepEqual(Array.from(files, file => file.id), ['first', 'later']);
    assert.deepEqual(pages, [null, 'page-2/+']);
  }
});

test('fallar una página rechaza el listado completo para no ocultar un historial incompleto', async () => {
  const h = setup();
  await h.Drive.initFolderStructure();
  h.handle(async url => new URL(url).searchParams.has('pageToken')
    ? json({}, 403)
    : json({ files: [{ id: 'first' }], nextPageToken: 'next' }));
  await assert.rejects(h.Drive.listMenuFiles(), /403/);
});
