const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const datesSource = fs.readFileSync(path.join(__dirname, '../js/utils/dates.js'), 'utf8');
const menuSource = fs.readFileSync(path.join(__dirname, '../js/modules/menu.js'), 'utf8');
const copy = value => JSON.parse(JSON.stringify(value));
const normalize = value => (value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
const ref = id => ({ id, nombre: id });
const dish = (id, extra = {}) => ({
  id, nombre: id, activo: true, tipoMenu: ['mayores'], tipoComida: ['ambos'],
  tipoPlato: 'unico', frecuenciaMinSemanas: 1, etiquetas: [], ingredientes: [], ...extra,
});
const block = (mayores = [], bebe = [], extra = {}) => ({
  activo: true, platosMayores: mayores.map(value => typeof value === 'string' ? ref(value) : value),
  platosBebe: bebe.map(value => typeof value === 'string' ? ref(value) : value), ...extra,
});
const day = (fecha, comida = block(), cena = { activo: false }) => ({ fecha, comida, cena });
const menu = (dias, extra = {}) => ({ estado: 'confirmado', generadoEn: '2026-11-10T10:00:00Z', dias, ...extra });
const twoWeeks = (id, extra = {}) => [menu([
  day('2026-11-02', block([id])), day('2026-11-09', block([id])),
], extra)];

function setup({ platos = [], menus = [], config = {}, inventario = [], today = '2026-11-30' } = {}) {
  const state = { platos, config, inventario };
  const reads = [];
  const context = {
    App: { getState: () => state },
    Sync: { normalize },
    Drive: {
      listMenuFiles: async () => menus.map((_, i) => ({ id: String(i) })),
      readMenuJson: async id => { reads.push(id); return copy(menus[Number(id)]); },
    },
    document: { getElementById: () => null },
    setTimeout: callback => { callback(); return 0; },
    randomValue: 0,
    fixedToday: today,
  };
  const source = menuSource
    .replace('_paso=5; _renderAsistente();', '_paso=5;')
    .replace('return { render, getCalendarioHTML };', `return {
      build: _construirHabitos, weight: _pesoHabito, choose: _elegirPlato,
      includeWeek: _incluirSemanaActual, combine: _combinarDiasDeMenus,
      secondAdult: _elegirSegundoMayores,
      firstBaby: _elegirPrimeroBebe, secondBaby: _elegirSegundoBebe,
      babyLunch: _generarBloqueBebeComida,
      generate: _generarMenu, setMenu: menu => { _menuEnCurso=menu; },
      getMenu: () => _menuEnCurso,
    };`);
  vm.createContext(context);
  vm.runInContext(`${datesSource}\n${source}\nthis.engine=Menu; Math.random=()=>randomValue; Dates.today=()=>fixedToday;`, context);
  return {
    engine: context.engine, state, reads,
    random: value => { context.randomValue = value; },
  };
}

const weight = (engine, plato, modelo, extra = {}) => engine.weight(plato, {
  modelo, perfil: 'mayores', momento: 'comida', fecha: '2026-11-23', ...extra,
});

test('sin historial o con una sola semana todas las opciones conservan peso neutro', () => {
  const platos = [dish('frecuente'), dish('nuevo')];
  const { engine } = setup({ platos });
  for (const history of [[], [menu([
    day('2026-11-02', block(['frecuente'])), day('2026-11-03', block(['frecuente'])),
    day('2026-11-04', block(['frecuente'])),
  ])]]) {
    const model = engine.build(history, platos, '2026-11-23');
    for (const plato of platos) assert.equal(weight(engine, plato, model), 1);
  }
});

test('los hábitos pertenecen al perfil y momento que los originaron', () => {
  const platos = [dish('adulto'), dish('bebe', { tipoMenu: ['bebe'] })];
  const history = [menu(['2026-11-02', '2026-11-09'].map(fecha =>
    day(fecha, block(['adulto']), block([], ['bebe']))))];
  const { engine } = setup({ platos });
  const model = engine.build(history, platos, '2026-11-23');
  assert.ok(weight(engine, platos[0], model) > 1);
  assert.equal(weight(engine, platos[0], model, { momento: 'cena' }), 1);
  assert.equal(weight(engine, platos[1], model, { perfil: 'bebe' }), 1);
  assert.ok(weight(engine, platos[1], model, { perfil: 'bebe', momento: 'cena' }) > 1);
});

test('la misma rutina semanal gana peso sin impedir explorar platos nuevos del catálogo', () => {
  const platos = [dish('habitual'), dish('nuevo', { tipoPlato: 'primero' })];
  const { engine } = setup({ platos });
  const model = engine.build(twoWeeks('habitual'), platos, '2026-11-23');
  const sameDay = weight(engine, platos[0], model);
  const otherDay = weight(engine, platos[0], model, { fecha: '2026-11-24' });
  assert.ok(sameDay > otherDay);
  assert.ok(sameDay <= 6);
  assert.ok(weight(engine, platos[1], model) >= 1);
  assert.ok(weight(engine, platos[1], model) < sameDay);
});

test('las referencias duplicadas cuentan una vez por bloque y resuelven el nombre normalizado actual', () => {
  const platos = [dish('actual', { nombre: 'Arroz con Atún' })];
  const repeated = [ref('actual'), ref('actual'), { nombre: ' arroz CON atun ' }, ref('desconocido'), ref('inactivo')];
  const { engine } = setup({ platos });
  const model = engine.build([menu([
    day('2026-11-02', block(repeated)),
    day('2026-11-09', block([{ id: 'id-antiguo', nombre: ' arroz CON atun ' }, { nombre: 'Arroz con atun' }])),
  ])], platos, '2026-11-23');
  const stats = model.perfiles.mayores.comida;
  assert.equal(stats.platos.get('actual'), 2);
  assert.equal(stats.platos.has('desconocido'), false);
  assert.equal(stats.platos.has('inactivo'), false);
  assert.equal(stats.tipos.get('unico'), 2);
  assert.equal(stats.semanas.size, 2);
});

test('solo confirmado e histórico anteriores al corte alimentan el modelo', () => {
  const platos = [dish('valido'), dish('rechazado')];
  const history = [
    ...twoWeeks('valido', { estado: 'historico' }),
    ...twoWeeks('rechazado', { estado: 'borrador' }),
    ...twoWeeks('rechazado', { estado: 'pendiente' }),
    menu([day('2026-11-23', block(['rechazado']))]),
    menu([day('2026-11-24', block(['rechazado']))]),
    menu([day('2026-11-03', block(['rechazado'], [], { activo: false }))]),
    menu([day('2026-11-04', block(['rechazado'], [], { _mayActivo: false }))]),
  ];
  const { engine } = setup({ platos });
  const model = engine.build(history, platos, '2026-11-23');
  assert.equal(model.perfiles.mayores.comida.platos.get('valido'), 2);
  assert.equal(model.perfiles.mayores.comida.platos.has('rechazado'), false);
});

test('un horizonte futuro no aprende de menús de hoy ni de días todavía futuros', () => {
  const platos = [dish('pasado'), dish('futuro')];
  const { engine } = setup({ platos, today: '2026-11-13' });
  const history = [menu([
    day('2026-11-02', block(['pasado'])), day('2026-11-09', block(['pasado'])),
    day('2026-11-13', block(['futuro'])), day('2026-11-16', block(['futuro'])),
  ])];
  const model = engine.build(history, platos, '2026-11-23');
  assert.equal(model.perfiles.mayores.comida.platos.has('futuro'), false);
  assert.equal(model.perfiles.mayores.comida.platos.get('pasado'), 2);
});

test('los solapes usan confirmadoEn y no duplican ni resucitan la generación antigua', () => {
  const platos = [dish('antiguo'), dish('actual')];
  const older = twoWeeks('antiguo', { generadoEn: '2026-11-20T10:00:00Z' })[0];
  const newer = twoWeeks('actual', { generadoEn: '2026-11-19T10:00:00Z', confirmadoEn: '2026-11-21T10:00:00Z' })[0];
  const { engine } = setup({ platos });
  for (const history of [[older, newer], [newer, older]]) {
    const model = engine.build(history, platos, '2026-11-23');
    assert.equal(model.perfiles.mayores.comida.platos.get('actual'), 2);
    assert.equal(model.perfiles.mayores.comida.platos.has('antiguo'), false);
    assert.equal(engine.combine(history)[0].comida.platosMayores[0].id, 'actual');
  }
});

test('la ruleta favorece el hábito y mantiene probabilidad positiva para novedades', () => {
  const platos = [dish('nuevo', { tipoPlato: 'primero' }), dish('habitual')];
  const { engine, random } = setup({ platos });
  const model = engine.build(twoWeeks('habitual'), platos, '2026-11-23');
  const context = { modelo: model, perfil: 'mayores', momento: 'comida', fecha: '2026-11-23' };
  random(0.4);
  assert.equal(engine.choose(platos, [], [], context).id, 'habitual');
  random(0);
  assert.equal(engine.choose(platos, [], [], context).id, 'nuevo');
  random(0.999999);
  assert.equal(engine.choose(platos, [], [], context).id, 'habitual');
});

test('aprovechar ingredientes prioritarios conserva precedencia sobre los hábitos', () => {
  const platos = [dish('habitual'), dish('prioritario', {
    ingredientes: [{ nombre: 'Tomate' }], tipoPlato: 'primero',
  })];
  const { engine, random } = setup({ platos });
  const model = engine.build(twoWeeks('habitual'), platos, '2026-11-23');
  const context = { modelo: model, perfil: 'mayores', momento: 'comida', fecha: '2026-11-23' };
  for (const value of [0, 0.4, 0.999999]) {
    random(value);
    assert.equal(engine.choose(platos, ['tomate'], [], context).id, 'prioritario');
  }
  assert.equal(engine.choose([], [], [], context), null);
});

test('generar con Drive simulado aplica hábitos en adultos y bebé y deja evidencia en el menú', async () => {
  const familiarMayor = dish('adulto-habitual', { tipoComida: ['comida'] });
  const familiarBebe = dish('bebe-habitual', { tipoMenu: ['bebe'], tipoComida: ['comida'] });
  const platos = [
    dish('adulto-nuevo', { tipoComida: ['comida'] }), familiarMayor,
    dish('bebe-nuevo', { tipoMenu: ['bebe'], tipoComida: ['comida'] }), familiarBebe,
  ];
  const menus = [menu(['2026-11-02', '2026-11-09'].map(fecha =>
    day(fecha, block([familiarMayor.id], [familiarBebe.id]))))];
  const { engine, reads, random, state } = setup({ platos, menus, config: {
    personas: [{ tipo: 'bebe' }],
    tiposDiaEspecial: [{ id: 'sin-cena', afectaCena: true, afectaA: 'todos' }],
  } });
  random(0.4);
  engine.setMenu({ fechaInicio: '2026-11-23', numSemanas: 1,
    dias: Array.from({ length: 7 }, (_, i) => ({ fecha: `2026-11-${23 + i}`, tipoEspecial: 'sin-cena' })),
  });
  const original = copy(state.platos);
  await engine.generate();
  const generated = copy(engine.getMenu());
  assert.equal(reads.length, 1);
  assert.equal(generated.dias[0].comida.platosMayores[0].id, familiarMayor.id);
  assert.equal(generated.dias[0].comida.platosBebe[0].id, familiarBebe.id);
  assert.ok(generated.adaptacionHabitos);
  assert.equal(generated.adaptacionHabitos.semanasObservadas.mayores.comida, 2);
  assert.equal(generated.adaptacionHabitos.semanasObservadas.bebe.comida, 2);
  assert.equal(generated.adaptacionHabitos.semanasObservadas.mayores.cena, 0);
  assert.deepEqual(state.platos, original);
});

test('la semana actual aparece vacía al mostrar solo históricos y no se duplica si ya existe', () => {
  const { engine } = setup();
  const history = [day('2026-11-02', block(['antiguo']))];
  const result = engine.includeWeek(history, '2026-11-13');
  assert.equal(result.filter(d => d.fecha >= '2026-11-09' && d.fecha <= '2026-11-15').length, 7);
  assert.equal(result.find(d => d.fecha === '2026-11-13').comida.activo, false);
  assert.equal((result.find(d => d.fecha === '2026-11-13').comida.platosMayores || []).length, 0);
  assert.equal(result.find(d => d.fecha === '2026-11-02').comida.platosMayores[0].id, 'antiguo');
  assert.equal(engine.includeWeek(result, '2026-11-13').length, result.length);
});

test('planificar con mucha antelación conserva las seis semanas reales anteriores a hoy', async () => {
  const platos = [dish('nuevo'), dish('habitual')];
  const { engine, random } = setup({ platos, menus: twoWeeks('habitual'), today: '2026-11-13' });
  random(0.4);
  engine.setMenu({ fechaInicio: '2027-01-04', numSemanas: 1, dias: [] });
  await engine.generate();
  const generated = engine.getMenu();
  assert.equal(generated.adaptacionHabitos.fechaCorte, '2026-11-13');
  assert.equal(generated.adaptacionHabitos.semanasObservadas.mayores.comida, 2);
  assert.equal(generated.dias[0].comida.platosMayores[0].id, 'habitual');
});

test('los complementos reciben hábitos conservando la prioridad de menor uso semanal del bebé', () => {
  for (const tipo of ['primero', 'segundo']) {
    const platos = [dish('nuevo', { tipoMenu: ['todos'], tipoPlato: tipo }),
      dish('habitual', { tipoMenu: ['todos'], tipoPlato: tipo, permiteRepeticion: true })];
    const { engine, random } = setup({ platos });
    const history = [menu(['2026-11-02', '2026-11-09'].map(fecha =>
      day(fecha, block(['habitual'], ['habitual']))))];
    const model = engine.build(history, platos, '2026-11-23');
    const babyContext = { modelo: model, perfil: 'bebe', momento: 'comida', fecha: '2026-11-23' };
    random(0.4);
    const selectBaby = tipo === 'primero' ? engine.firstBaby : engine.secondBaby;
    assert.equal(selectBaby(platos, [], {}, 'comida', babyContext).id, 'habitual');
    assert.equal(selectBaby(platos, ['habitual'], {}, 'comida', babyContext).id, 'nuevo');
    if (tipo === 'segundo') {
      const adultContext = { ...babyContext, perfil: 'mayores' };
      assert.equal(engine.secondAdult(platos, new Map(), {}, 0, 'comida', new Map(), adultContext).id, 'habitual');
    }
  }
});

test('compatibilidad con adultos y sobras conservan precedencia sobre el plato habitual del bebé', () => {
  const platos = [dish('compartido', { tipoMenu: ['todos'] }), dish('sobra', { tipoMenu: ['bebe'] }),
    dish('habitual', { tipoMenu: ['bebe'] })];
  const { engine, random } = setup({ platos });
  const model = engine.build([menu(['2026-11-02', '2026-11-09'].map(fecha =>
    day(fecha, block([], ['habitual']))))], platos, '2026-11-23');
  const context = { modelo: model, perfil: 'bebe', momento: 'comida', fecha: '2026-11-23' };
  random(0.99);
  assert.equal(engine.babyLunch([ref('compartido')], platos, [], {}, new Set(), {}, {}, false, [], [], context)[0].id, 'compartido');
  assert.equal(engine.babyLunch([], platos, [], {}, new Set(), { sobra: 1 }, {}, false, [], [], context)[0].id, 'sobra');
});

test('las referencias retiradas del catálogo cuentan como observación sin inflar la frecuencia de las vigentes', () => {
  const platos = [dish('vigente')];
  const { engine } = setup({ platos });
  const history = [menu([
    day('2026-11-02', block(['vigente'])),
    day('2026-11-03', block(['eliminado-a'])),
    day('2026-11-09', block(['eliminado-b'])),
    day('2026-11-10', block()),
  ])];
  const model = engine.build(history, platos, '2026-11-23');
  const stats = model.perfiles.mayores.comida;
  assert.equal(stats.total, 3);
  assert.equal(stats.semanas.size, 2);
  assert.equal(stats.platos.get('vigente'), 1);
  assert.equal(stats.platos.has('eliminado-a'), false);
  assert.equal(stats.tipos.get('unico'), 1);
  assert.equal(stats.dias.get(1).total, 2);
  const allKnown = engine.build([menu([
    day('2026-11-02', block(['vigente'])), day('2026-11-09', block(['vigente'])),
  ])], platos, '2026-11-23');
  assert.ok(weight(engine, platos[0], model) < weight(engine, platos[0], allKnown));
});
