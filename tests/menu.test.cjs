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
  const writes = [];
  const navigations = [];
  const toasts = [];
  const context = {
    App: { getState: () => state, setState: async (key, value) => { state[key] = value; }, navigate: view => navigations.push(view) },
    UI: { activateView() {}, showToast: (...args) => toasts.push(args) },
    Notificaciones: { generarParaMenu: menu => menu.notifs || [] },
    Sync: { normalize: value => (value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim() },
    Drive: {
      listMenuFiles: async () => menus.map((_, index) => ({ id: String(index) })),
      readMenuJson: async id => { reads.push(id); return copy(menus[Number(id)]); },
      writeMenuJson: async (name, data, id) => writes.push({ name, data: copy(data), id }),
    },
    document: { getElementById: () => null },
    setTimeout: callback => { callback(); return 0; },
    clearTimeout() {},
  };
  const source = menuSource
    .replace('_paso=5; _renderAsistente();', '_paso=5;')
    .replace('return { render, getCalendarioHTML, editar };', `return {
      getCalendarioHTML, history: _buildUsadosReciente, load: _cargarHistorialReciente,
      consumed: _calcularConsumidosAntesDel, filter: _filtrarMayores,
      second: _elegirSegundoMayores, register: _registrarMayor,
      generate: _generarMenu, setMenu: menu => { _menuEnCurso=menu; },
      getMenu: () => _menuEnCurso, edit: editar, save: _confirmarMenu,
    };`);
  vm.createContext(context);
  vm.runInContext(`${datesSource}\n${source}\nthis.engine=Menu; Math.random=()=>0;`, context);
  return { ...context, reads, writes, navigations, toasts, state };
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

test('la cena admite primero, segundo o único compatibles como una sola preparación', async () => {
  for (const tipoPlato of ['primero', 'segundo', 'unico']) {
    const platos = Array.from({ length: 7 }, (_, i) => dish(`cena-${i}`, {
      tipoPlato, tipoComida: ['cena'], permiteRepeticion: false,
    }));
    const { engine } = setup({ platos });
    engine.setMenu({ fechaInicio: '2026-11-09', numSemanas: 1, dias: [] });
    await engine.generate();
    for (const [i, current] of engine.getMenu().dias.entries()) {
      assert.equal(current.comida.platosMayores.length, 0, 'No cambia compatibilidad comida/cena');
      assert.deepEqual(copy(current.cena.platosMayores), [ref(platos[i].id)], tipoPlato);
    }
  }
});

test('adultos respeta permiso semanal y días consecutivos también para segundos', () => {
  const { engine } = setup();
  for (const tipoPlato of ['unico', 'segundo']) {
    for (const permiteRepeticion of [false, true]) {
      const plato = dish('plato', { tipoPlato, permiteRepeticion });
      const select = (used, day) => tipoPlato === 'segundo'
        ? engine.second([plato], used, {}, day, 'comida', new Map())
        : engine.filter({ platos: [plato], momento: 'comida', usadosSemana: used,
          usadosReciente: {}, diaIndex: day, protPorDia: {}, cfgMenus: {}, contadorGrupos: {} })[0];
      assert.equal(Boolean(select(new Map([['plato', [0]]]), 1)), false, 'Nunca en días consecutivos');
      assert.equal(Boolean(select(new Map([['plato', [0]]]), 2)), permiteRepeticion, 'Segundo uso exige permiso');
      assert.equal(Boolean(select(new Map([['plato', [0, 2]]]), 4)), false, 'No excede dos usos semanales');
      assert.equal(Boolean(select(new Map(), 7)), true, 'Semana nueva permite volver a usar');
    }
  }
});

test('catálogo escaso no permite que el último recurso vulnere repetición ni facilidad', async () => {
  for (const permiteRepeticion of [false, true]) {
    const platos = [dish('limitado', { permiteRepeticion, preparacionFacil: true }),
      dish('dificil', { preparacionFacil: false, permiteRepeticion: true })];
    const config = { tiposDiaEspecial: [{ id: 'facil', esDiaFacil: true, facilMomentos: ['comida', 'cena'] }] };
    const { engine } = setup({ platos, config });
    engine.setMenu({ fechaInicio: '2026-11-09', numSemanas: 1, dias: Array.from({ length: 7 }, (_, i) => ({
      fecha: `2026-11-${String(9 + i).padStart(2, '0')}`, tipoEspecial: 'facil',
    })) });
    await engine.generate();
    const uses = engine.getMenu().dias.flatMap((current, i) => ['comida', 'cena'].flatMap(moment =>
      current[moment].platosMayores.map(p => ({ id: p.id, day: i }))));
    assert.equal(uses.length, permiteRepeticion ? 2 : 1);
    assert.ok(uses.every(use => use.id === 'limitado'));
    if (permiteRepeticion) assert.ok(uses[1].day - uses[0].day > 1);
  }
});

test('un día fácil exige facilidad también en el segundo adulto que acompaña al primero', async () => {
  const platos = [dish('primero-facil', { tipoPlato: 'primero', preparacionFacil: true, tipoComida: ['comida'] }),
    dish('segundo-dificil', { tipoPlato: 'segundo', preparacionFacil: false, tipoComida: ['comida'] }),
    dish('segundo-facil', { tipoPlato: 'segundo', preparacionFacil: true, tipoComida: ['comida'] })];
  const config = { tiposDiaEspecial: [{ id: 'facil', esDiaFacil: true, facilMomentos: ['comida'] }] };
  const { engine } = setup({ platos, config });
  engine.setMenu({ fechaInicio: '2026-11-09', numSemanas: 1, dias: [{ fecha: '2026-11-09', tipoEspecial: 'facil' }] });
  await engine.generate();
  assert.deepEqual(copy(engine.getMenu().dias[0].comida.platosMayores).map(p => p.id), ['primero-facil', 'segundo-facil']);
});


test('editar un histórico conserva archivo, estado, menú activo y avisos ajenos', async () => {
  const h = setup({ config: { notificaciones: { activadas: true, pendientes: [{ id: 'aviso-activo' }] } } });
  const current = menu([day('2026-11-09', ['actual'])], { id: 'actual' });
  h.state.menuActual = current;
  const original = menu([day('2026-10-26', ['viejo'])], {
    id: 'pasado', estado: 'historico', fechaInicio: '2026-10-26', fechaFin: '2026-11-01',
    _fileId: 'archivo-original', _fileName: 'menu-antiguo.json',
  });
  h.engine.edit(original, 'historial');
  h.engine.getMenu().dias[0].comida.platosMayores = [ref('nuevo')];
  assert.equal(original.dias[0].comida.platosMayores[0].id, 'viejo', 'la edición es una copia');
  await h.engine.save();
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].id, 'archivo-original');
  assert.equal(h.writes[0].name, 'menu-antiguo.json');
  assert.equal(h.writes[0].data.estado, 'historico');
  assert.equal(h.writes[0].data.id, 'pasado');
  assert.equal(h.writes[0].data.dias[0].comida.platosMayores[0].id, 'nuevo');
  assert.equal('_fileId' in h.writes[0].data, false);
  assert.equal('_fileName' in h.writes[0].data, false);
  assert.strictEqual(h.state.menuActual, current);
  assert.deepEqual(copy(h.state.config.notificaciones.pendientes), [{ id: 'aviso-activo' }]);
  assert.deepEqual(h.navigations, ['historial']);
});

test('editar futuro de varias semanas conserva todos los días y reemplaza solo sus avisos', async () => {
  const h = setup({ config: { notificaciones: { pendientes: [{ id: 'ajeno' }, { id: 'viejo' }] } } });
  const original = menu(Array.from({ length: 14 }, (_, i) => day(`2026-12-${String(i + 1).padStart(2, '0')}`, ['igual'])), {
    id: 'futuro', fechaInicio: '2026-12-01', fechaFin: '2026-12-14', notifs: [{ id: 'viejo' }],
  });
  h.engine.edit(original);
  h.engine.getMenu().dias[13].comida.platosMayores = [ref('cambiado')];
  h.engine.getMenu().notifs = [{ id: 'nuevo' }];
  await h.engine.save();
  assert.equal(h.writes[0].name, 'semana_2026-12-01.json');
  assert.equal(h.writes[0].data.dias.length, 14);
  assert.equal(h.writes[0].data.dias[0].comida.platosMayores[0].id, 'igual');
  assert.equal(h.writes[0].data.dias[13].comida.platosMayores[0].id, 'cambiado');
  assert.deepEqual(copy(h.state.config.notificaciones.pendientes), [{ id: 'ajeno' }, { id: 'nuevo' }]);
  assert.equal(h.state.menuActual, undefined);
  assert.deepEqual(h.navigations, ['menu']);
});

test('un fallo al guardar permite reintentar sin perder cambios ni anunciar éxito', async () => {
  const h = setup();
  const writer = h.Drive.writeMenuJson;
  h.engine.edit(menu([day('2026-11-09', ['cambio'])], { id: 'actual' }));
  h.Drive.writeMenuJson = async () => { throw new Error('sin conexión'); };
  await h.engine.save();
  assert.equal(h.writes.length, 0);
  assert.equal(h.navigations.length, 0);
  assert.equal(h.toasts[0][1], 'error');
  assert.match(h.toasts[0][0], /sin conexión/);
  assert.equal(h.engine.getMenu().dias[0].comida.platosMayores[0].id, 'cambio');
  h.Drive.writeMenuJson = writer;
  await h.engine.save();
  assert.equal(h.writes.length, 1);
  assert.equal(h.toasts.at(-1)[1], 'success');
});

test('guardar una edición activa actualiza el estado y evita escrituras concurrentes', async () => {
  const h = setup();
  const original = menu([day('2026-11-09', ['viejo'])], { id: 'actual' });
  h.state.menuActual = original;
  h.engine.edit(original);
  h.engine.getMenu().dias[0].comida.platosMayores = [ref('nuevo')];
  const writer = h.Drive.writeMenuJson;
  let release;
  h.Drive.writeMenuJson = async (...args) => {
    await new Promise(resolve => { release = resolve; });
    return writer(...args);
  };
  const first = h.engine.save();
  await h.engine.save();
  release();
  await first;
  assert.equal(h.writes.length, 1);
  assert.equal(h.state.menuActual.dias[0].comida.platosMayores[0].id, 'nuevo');
});


test('Inicio comparte lecturas concurrentes y vuelve a consultar en la siguiente carga', async () => {
  const h = setup();
  let listings = 0, release;
  const pending = new Promise(resolve => { release = resolve; });
  h.Drive.listMenuFiles = () => { listings++; return pending; };
  const first = h.engine.getCalendarioHTML();
  const second = h.engine.getCalendarioHTML();
  assert.equal(listings, 1);
  release([]);
  await Promise.all([first, second]);
  await h.engine.getCalendarioHTML();
  assert.equal(listings, 2);
});
