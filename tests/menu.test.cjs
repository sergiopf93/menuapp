const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const datesSource = fs.readFileSync(path.join(__dirname, '../js/utils/dates.js'), 'utf8');
const menuSource = fs.readFileSync(path.join(__dirname, '../js/modules/menu.js'), 'utf8');
const copy = value => JSON.parse(JSON.stringify(value));

function setup({ menus = [], platos = [], config = {} } = {}) {
  const state = { platos, inventario: [], config };
  const reads = [];
  const context = {
    App: { getState: () => state },
    Drive: {
      listMenuFiles: async () => menus.map((_, index) => ({ id: String(index) })),
      readMenuJson: async id => { reads.push(id); return copy(menus[Number(id)]); },
    },
    document: { getElementById: () => null },
    setTimeout: callback => { callback(); return 0; },
  };
  const source = menuSource
    .replace('_paso=5; _renderAsistente();', '_paso=5;')
    .replace('return { render, getCalendarioHTML };', `return {
      history: _buildUsadosReciente, load: _cargarHistorialReciente,
      consumed: _calcularConsumidosAntesDel, filter: _filtrarMayores,
      second: _elegirSegundoMayores, register: _registrarMayor,
      generate: _generarMenu, setMenu: menu => { _menuEnCurso=menu; },
      getMenu: () => _menuEnCurso,
    };`);
  vm.createContext(context);
  vm.runInContext(`${datesSource}\n${source}\nthis.engine=Menu; Math.random=()=>0;`, context);
  return { ...context, reads, state };
}

const ref = id => ({ id, nombre: id });
const day = (fecha, mayores = [], bebe = [], extra = {}) => ({
  fecha,
  comida: { activo: true, platosMayores: mayores.map(ref), platosBebe: bebe.map(ref) },
  cena: { activo: false, platosMayores: [], platosBebe: [] },
  ...extra,
});
const menu = (dias, extra = {}) => ({ estado: 'confirmado', generadoEn: '2026-11-01T10:00:00Z', dias, ...extra });
const dish = (id, extra = {}) => ({
  id, nombre: id, activo: true, tipoMenu: ['mayores'], tipoComida: ['ambos'],
  tipoPlato: 'unico', frecuenciaMinSemanas: 1, etiquetas: [], ...extra,
});

test('historial usa semanas reales de lunes a domingo y mantiene la distancia cero', () => {
  const { engine } = setup();
  const history = [menu([
    day('2026-11-01', ['anterior']),
    day('2026-11-08', ['domingo']),
    day('2026-11-09', ['lunes']),
  ])];
  assert.deepEqual(copy(engine.history(history, '2026-11-11')), { anterior: 2, domingo: 1, lunes: 0 });
  assert.equal(engine.history([menu([day('2026-03-29', ['cambio-hora'])])], '2026-03-30')['cambio-hora'], 1);
});

test('historial ignora futuro, borradores y bloques inactivos; separa adultos y bebé', () => {
  const { engine } = setup();
  const history = [
    menu([day('2026-11-08', ['adulto'], ['bebe'])]),
    menu([day('2026-11-09', ['inicio']), day('2026-11-10', ['futuro'])]),
    menu([day('2026-11-07', ['borrador'])], { estado: 'borrador' }),
    menu([day('2026-11-06', [], [], { comida: { activo: false, platosMayores: [ref('cancelado')] } })]),
    menu([day('2026-11-05', [], [], { comida: {
      activo: true, _mayActivo: false, platosMayores: [ref('adulto-cancelado')], platosBebe: [ref('bebe-activo')],
    } })]),
  ];
  assert.deepEqual(copy(engine.history(history, '2026-11-09', 'mayores')), { adulto: 1 });
  assert.deepEqual(copy(engine.history(history, '2026-11-09', 'bebe')), { bebe: 1, 'bebe-activo': 1 });
});

test('días solapados usan la generación más reciente independientemente del orden del archivo', () => {
  const { engine } = setup();
  const older = menu([day('2026-11-08', ['viejo'])]);
  const newer = menu([day('2026-11-08', ['nuevo'])], { generadoEn: '2026-11-08T11:00:00Z' });
  for (const history of [[older, newer], [newer, older]]) {
    assert.deepEqual(copy(engine.history(history, '2026-11-09')), { nuevo: 1 });
  }
});

test('carga seis semanas por sus días reales, sin cortar por los seis primeros archivos', async () => {
  const menus = Array.from({ length: 8 }, () => menu([day('2025-01-01', ['antiguo'])]));
  menus.push(menu([day('2026-11-08', ['reciente']), day('2026-11-10', ['futuro'])]));
  menus.push(menu([day('2026-11-07', ['borrador'])], { estado: 'borrador' }));
  const { engine, reads } = setup({ menus });
  const history = await engine.load(6, '2026-11-09');
  assert.equal(reads.length, 10);
  assert.deepEqual(copy(history.flatMap(m => m.dias).map(d => d.fecha)), ['2026-11-08']);
});

test('consumos anteriores no duplican menús solapados ni suman borradores o futuro', () => {
  const platos = [dish('a', { ingredientes: [{ nombre: 'Arroz', cantidad: 2 }] })];
  const { engine } = setup({ platos });
  const history = [
    menu([day('2026-11-08', ['a'])]),
    menu([day('2026-11-08', ['a'])], { generadoEn: '2026-11-08T11:00:00Z' }),
    menu([day('2026-11-10', ['a'])]),
    menu([day('2026-11-07', ['a'])], { estado: 'borrador' }),
  ];
  assert.deepEqual(copy(engine.consumed(history, '2026-11-09')), { arroz: 2 });
});

test('frecuencia respeta usos en la misma semana y conserva consecutivos domingo-lunes', () => {
  const { engine } = setup();
  const p = dish('a');
  const common = {
    platos: [p], momento: 'comida', usadosSemana: new Map(), artsPrioritarios: new Set(),
    protPorDia: {}, diaIndex: 7, cfgMenus: {}, contadorGrupos: {},
  };
  assert.equal(engine.filter({ ...common, usadosReciente: { a: 0 } }).length, 0);
  assert.equal(engine.filter({ ...common, usadosReciente: { a: 1 } }).length, 1);
  const last = new Map([['a', 6]]);
  assert.equal(engine.filter({ ...common, usadosReciente: {}, ultimoUsoMayores: last }).length, 0);
  const segundo = dish('a', { tipoPlato: 'segundo' });
  assert.equal(engine.second([segundo], new Map(), {}, 7, 'comida', last), null);
  assert.equal(engine.filter({ ...common, diaIndex: 8, usadosReciente: {}, ultimoUsoMayores: last }).length, 1);
});

test('generación de varias semanas reinicia límites adultos y grupos cada lunes', async () => {
  const platos = [dish('carne', { etiquetas: ['carne-roja'] }),
    ...Array.from({ length: 20 }, (_, i) => dish(`neutro-${i}`))];
  const { engine } = setup({ platos });
  engine.setMenu({ fechaInicio: '2026-11-09', numSemanas: 2, dias: [] });
  await engine.generate();
  const days = copy(engine.getMenu().dias);
  for (const week of [days.slice(0, 7), days.slice(7)]) {
    const uses = new Map();
    week.forEach(d => ['comida', 'cena'].forEach(m => d[m].platosMayores.forEach(p => {
      uses.set(p.id, (uses.get(p.id) || 0) + 1);
    })));
    assert.equal(uses.get('carne'), 1);
    assert.ok([...uses.values()].every(count => count <= 2));
  }
  const sundayIds = days[6].cena.platosMayores.map(p => p.id);
  assert.ok(days[7].comida.platosMayores.every(p => !sundayIds.includes(p.id)));
});

test('semana parcial incluye los usos anteriores al inicio del horizonte', async () => {
  const platos = [dish('carne', { etiquetas: ['carne-roja'] }),
    ...Array.from({ length: 20 }, (_, i) => dish(`neutro-${i}`))];
  const { engine } = setup({ platos, menus: [menu([day('2026-11-09', ['carne'])])] });
  engine.setMenu({ fechaInicio: '2026-11-11', numSemanas: 1, dias: [] });
  await engine.generate();
  const days = copy(engine.getMenu().dias);
  assert.ok(days.filter(d => d.fecha < '2026-11-16')
    .every(d => ['comida', 'cena'].every(m => d[m].platosMayores.every(p => p.id !== 'carne'))));
  assert.equal(days.find(d => d.fecha === '2026-11-16').comida.platosMayores[0].id, 'carne');
});

test('usos del bebé se reinician al cambiar de lunes sin alterar el catálogo', async () => {
  const platos = Array.from({ length: 7 }, (_, i) => dish(`bebe-${i}`, {
    tipoMenu: ['bebe'], permiteRepeticion: false,
  }));
  const config = { personas: [{ tipo: 'bebe' }], tiposDiaEspecial: [
    { id: 'sin-cena', afectaCena: true, afectaA: 'todos' },
  ] };
  const { engine } = setup({ platos, config });
  engine.setMenu({ fechaInicio: '2026-11-09', numSemanas: 2,
    dias: Array.from({ length: 14 }, (_, i) => ({
      fecha: new Date(Date.UTC(2026, 10, 9 + i)).toISOString().slice(0, 10), tipoEspecial: 'sin-cena',
    })),
  });
  await engine.generate();
  const days = copy(engine.getMenu().dias);
  assert.deepEqual(days.slice(0, 7).map(d => d.comida.platosBebe[0]?.id), platos.map(p => p.id));
  assert.deepEqual(days.slice(7).map(d => d.comida.platosBebe[0]?.id), platos.map(p => p.id));
  assert.ok(platos.every(p => p.frecuenciaMinSemanas === 1 && p.permiteRepeticion === false));
});

test('la frecuencia configurada incluye las semanas anteriores recién generadas', async () => {
  const platos = Array.from({ length: 40 }, (_, i) => dish(`plato-${i}`, { frecuenciaMinSemanas: 2 }));
  const { engine } = setup({ platos });
  engine.setMenu({ fechaInicio: '2026-11-09', numSemanas: 2, dias: [] });
  await engine.generate();
  const days = copy(engine.getMenu().dias);
  const ids = days => days.flatMap(d => ['comida', 'cena'].flatMap(m => d[m].platosMayores.map(p => p.id)));
  const firstWeek = new Set(ids(days.slice(0, 7)));
  assert.ok(ids(days.slice(7)).every(id => !firstWeek.has(id)));
});

test('las sobras del domingo siguen disponibles para el bebé al cambiar de semana', async () => {
  const platos = [
    dish('compartido', { tipoMenu: ['todos'], tipoComida: ['comida'], diasSobras: 1 }),
    ...Array.from({ length: 10 }, (_, i) => dish(`adulto-${i}`, { tipoComida: ['comida'] })),
  ];
  const config = { personas: [{ tipo: 'bebe' }], tiposDiaEspecial: [
    { id: 'sin-cena', afectaCena: true, afectaA: 'todos' },
  ] };
  const { engine } = setup({ platos, config });
  engine.setMenu({ fechaInicio: '2026-11-08', numSemanas: 1,
    dias: Array.from({ length: 7 }, (_, i) => ({
      fecha: new Date(Date.UTC(2026, 10, 8 + i)).toISOString().slice(0, 10), tipoEspecial: 'sin-cena',
    })),
  });
  await engine.generate();
  const days = copy(engine.getMenu().dias);
  assert.equal(days[0].comida.platosMayores[0].id, 'compartido');
  assert.equal(days[1].comida.platosMayores[0].id, 'adulto-0');
  assert.equal(days[1].comida.platosBebe[0].id, 'compartido');
});
