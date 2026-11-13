const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = name => fs.readFileSync(path.join(__dirname, '../js', name), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
function setup(extra = {}) {
  const context = {
    Sync: { normalize: value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim() },
    ...extra,
  };
  vm.createContext(context);
  vm.runInContext(`${source('utils/dates.js')}\n${source('modules/historial.js')}\nthis.Historial = Historial; this.Dates = Dates;`, context);
  return context;
}
const adulto = { id: 'a', nombre: 'Lentejas' };
const bebe = { id: 'b', nombre: 'Puré' };
const catalogo = [{ ...adulto, frecuenciaMinSemanas: 3 }, { ...bebe, frecuenciaMinSemanas: 1 }];
const dia = (fecha, comida = [adulto], cena = [], bebeComida = [], bebeCena = []) => ({
  fecha,
  comida: { activo: true, platosMayores: comida, platosBebe: bebeComida },
  cena: { activo: true, platosMayores: cena, platosBebe: bebeCena },
});
const menu = (dias, extra = {}) => ({ id: 'm', estado: 'confirmado', confirmadoEn: '2026-10-25T12:00:00Z', dias, ...extra });

test('separa semanas lunes-domingo completas y parciales sin diluir su promedio', () => {
  const { Historial, Dates } = setup();
  const dias = [...Dates.range('2026-10-26', 14), '2026-11-09'].map(fecha => dia(fecha, Dates.dayName(fecha) === 'Lunes' ? [adulto] : []));
  const result = Historial.analizarMenus([menu(dias)], catalogo, '2026-11-13');
  assert.equal(result.cobertura.semanasCompletas, 2);
  assert.equal(result.cobertura.semanasParciales, 1);
  assert.equal(result.platos[0].total, 3);
  assert.equal(result.platos[0].promedioPorSemanaCompleta, 1);
  assert.equal(result.platos[0].aparicionesSemanasParciales, 1);
  assert.equal(result.cobertura.semanas[0].inicio, '2026-10-26');
  assert.equal(result.cobertura.semanas[0].fin, '2026-11-01');
});

test('separa perfiles y momentos y cuenta apariciones, sin multiplicar por personas', () => {
  const { Historial } = setup();
  const result = Historial.analizarMenus([menu([dia('2026-11-02', [adulto], [adulto], [bebe], [bebe])])], catalogo, '2026-11-13');
  assert.equal(result.platos.length, 2);
  const adultos = result.platos.find(plato => plato.perfil === 'adultos');
  const infantil = result.platos.find(plato => plato.perfil === 'bebe');
  for (const plato of [adultos, infantil]) {
    assert.equal(plato.comida, 1);
    assert.equal(plato.cena, 1);
    assert.equal(plato.total, 2);
    assert.equal(plato.promedioPorSemanaCompleta, null);
  }
  assert.deepEqual(plain(result.diasSemana[0]), { dia: 'Lunes', adultos: { comida: 1, cena: 1 }, bebe: { comida: 1, cena: 1 } });
});

test('deduplica fechas solapadas por confirmadoEn con fallback generadoEn', () => {
  const { Historial } = setup();
  const old = menu([dia('2026-11-02', [adulto])]);
  const updated = menu([dia('2026-11-02', [], [], [bebe])], { confirmadoEn: null, generadoEn: '2026-11-01T12:00:00Z' });
  for (const pair of [[old, updated], [updated, old]]) {
    const result = Historial.analizarMenus(pair, catalogo, '2026-11-13');
    assert.equal(result.cobertura.dias, 1);
    assert.equal(result.platos.length, 1);
    assert.equal(result.platos[0].perfil, 'bebe');
    assert.equal(result.exclusiones.solapesResueltos, 1);
  }
});

test('excluye borradores, hoy, futuro y fechas inválidas', () => {
  const { Historial } = setup();
  const result = Historial.analizarMenus([
    menu([dia('2026-11-12')]),
    menu([dia('2026-11-11')], { estado: 'borrador' }),
    menu([dia('2026-11-13'), dia('2026-11-14'), dia('2026-02-30'), dia('invalida')]),
  ], catalogo, '2026-11-13');
  assert.equal(result.cobertura.dias, 1);
  assert.equal(result.platos[0].total, 1);
  assert.equal(result.exclusiones.borradores, 1);
  assert.equal(result.exclusiones.diasHoyOFuturos, 2);
  assert.equal(result.periodo.hasta, '2026-11-12');
  assert.equal(result.tipo, 'planificacion_historica');
  assert.match(result.descripcion, /No representan consumo confirmado/);
});

test('respeta bloques y perfiles inactivos y no duplica referencias en un mismo bloque', () => {
  const { Historial } = setup();
  const inactive = dia('2026-11-02', [adulto], [adulto], [bebe], [bebe]);
  inactive.comida._mayActivo = false;
  inactive.cena.activo = false;
  const duplicate = dia('2026-11-03', [adulto, adulto], [], [bebe]);
  duplicate.comida._bebeActivo = false;
  const result = Historial.analizarMenus([menu([inactive, duplicate])], catalogo, '2026-11-13');
  assert.equal(result.platos.find(plato => plato.perfil === 'adultos').total, 1);
  assert.equal(result.platos.find(plato => plato.perfil === 'bebe').total, 1);
});

test('el intervalo usa semanas distintas y conserva frecuencia configurada sin escribir catálogo', () => {
  const { Historial } = setup();
  const menus = [menu([dia('2026-10-26'), dia('2026-10-27'), dia('2026-11-09')])];
  const before = JSON.stringify({ menus, catalogo });
  const result = Historial.analizarMenus(menus, catalogo, '2026-11-13');
  assert.deepEqual(plain(result.platos[0].intervalosSemanas), [2]);
  assert.equal(result.platos[0].intervaloMedioSemanas, 2);
  assert.equal(result.platos[0].frecuenciaMinSemanas, 3);
  assert.equal(JSON.stringify({ menus, catalogo }), before);
});

test('identifica platos ausentes y reconoce referencias antiguas por nombre normalizado', () => {
  const { Historial } = setup();
  const result = Historial.analizarMenus([menu([dia('2026-11-02', [
    { nombre: ' LÉNTEJAS ' }, { id: 'antiguo', nombre: 'Plato retirado' },
  ])])], catalogo, '2026-11-13');
  assert.equal(result.platosAusentesCatalogo.length, 1);
  assert.equal(result.platosAusentesCatalogo[0].nombre, 'Plato retirado');
  assert.equal(result.platos.find(plato => plato.id === 'a').existeEnCatalogo, true);
});

test('sin datos devuelve cobertura vacía y siete días sin inferencias', () => {
  const { Historial } = setup();
  const result = Historial.analizarMenus([], [], '2026-11-13');
  assert.equal(result.cobertura.dias, 0);
  assert.equal(result.platos.length, 0);
  assert.equal(result.periodo.desde, null);
  assert.equal(result.diasSemana.length, 7);
});

test('el botón analiza solo menús descargados, escapa nombres y exporta informe y fuentes', async () => {
  const callbacks = new Map();
  const elements = new Map([
    ['view-historial', { innerHTML: '' }],
    ['hist-content', { innerHTML: '', querySelectorAll: () => [] }],
    ['hist-analizar', { disabled: true, addEventListener: (name, fn) => callbacks.set(name, fn) }],
  ]);
  let modal, exportedBlob, clicked = false, revoked = false;
  const downloaded = menu([dia('2026-11-02', [{ id: 'x', nombre: '<script>plato</script>' }])], { fechaInicio: '2026-11-02', fechaFin: '2026-11-08' });
  const h = setup({
    document: {
      getElementById: id => elements.get(id),
      createElement: () => ({ click: () => { clicked = true; }, remove() {} }),
      body: { appendChild() {} },
    },
    App: { getState: () => ({ platos: [] }) },
    Drive: { listMenuFiles: async () => [{ id: 'file' }], readMenuJson: async () => downloaded },
    UI: { escapeHtml, showModal: options => { modal = options; } },
    Blob,
    URL: { createObjectURL: blob => { exportedBlob = blob; return 'blob:test'; }, revokeObjectURL: () => { revoked = true; } },
    setTimeout: callback => callback(),
  });
  h.Dates.today = () => '2026-11-13';
  h.Historial.render();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(elements.get('hist-analizar').disabled, false);
  callbacks.get('click')();
  assert.match(modal.content, /Planificación histórica, no consumo confirmado/);
  assert.match(modal.content, /&lt;script&gt;plato&lt;\/script&gt;/);
  assert.doesNotMatch(modal.content, /<script>/);
  assert.match(modal.content, /role="region"/);
  modal.buttons.find(button => button.label === 'Exportar JSON').onClick();
  const exported = JSON.parse(await exportedBlob.text());
  assert.equal(exported.informe.tipo, 'planificacion_historica');
  assert.equal(exported.datosFuente.menus[0]._fileId, 'file');
  assert.equal(clicked, true);
  assert.equal(revoked, true);
});
