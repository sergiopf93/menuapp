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
    .replace('return { render, getCalendarioHTML, editar };', `return {
      build: _construirHabitos, weight: _pesoHabito, choose: _elegirPlato,
      includeWeek: _incluirSemanaActual, combine: _combinarDiasDeMenus,
      secondAdult: _elegirSegundoMayores,
      firstBaby: _elegirPrimeroBebe, secondBaby: _elegirSegundoBebe,
      babyLunch: _generarBloqueBebeComida, babyDinner: _generarBloqueBebeConSobras,
      start: _iniciarAsistente, generate: _generarMenu, setMenu: menu => { _menuEnCurso=menu; },
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

test('planificar con mucha antelación conserva el historial real anterior a hoy', async () => {
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


test('hábitos usa por defecto los 28 días anteriores al corte sin ampliar hasta el lunes', () => {
  const platos = [dish('antes'), dish('limite'), dish('ayer'), dish('hoy')];
  const { engine } = setup({ platos, today: '2026-11-13' });
  const history = [menu([
    day('2026-10-15', block(['antes'])), day('2026-10-16', block(['limite'])),
    day('2026-11-12', block(['ayer'])), day('2026-11-13', block(['hoy'])),
  ])];
  const model = engine.build(history, platos, '2027-01-04');
  assert.equal(model.ventanaSemanas, 4);
  assert.deepEqual([...model.perfiles.mayores.comida.platos.keys()], ['limite', 'ayer']);
});

test('la ventana configurable respeta ambos extremos exactos incluso en cambio de hora', () => {
  const platos = [dish('antes'), dish('limite'), dish('ultimo'), dish('corte')];
  const { engine } = setup({ platos, today: '2026-11-13' });
  const shift = (date, days) => new Date(Date.parse(date + 'T12:00:00Z') + days * 86400000).toISOString().slice(0, 10);
  for (const weeks of [2, 4, 12]) {
    for (const horizon of ['2026-11-04', '2027-01-04']) {
      const cutoff = horizon < '2026-11-13' ? horizon : '2026-11-13';
      const model = engine.build([menu([
        day(shift(cutoff, -weeks * 7 - 1), block(['antes'])),
        day(shift(cutoff, -weeks * 7), block(['limite'])),
        day(shift(cutoff, -1), block(['ultimo'])),
        day(cutoff, block(['corte'])),
      ])], platos, horizon, weeks);
      assert.equal(model.fechaCorte, cutoff);
      assert.equal(model.ventanaSemanas, weeks);
      assert.deepEqual([...model.perfiles.mayores.comida.platos.keys()], ['limite', 'ultimo']);
    }
  }
});

test('generación lee las semanas guardadas en configuración y conserva ese valor en el borrador', async () => {
  const platos = [dish('habitual')];
  for (const weeks of [undefined, 2, 12]) {
    const { engine } = setup({ platos, today: '2026-11-13',
      config: { configuracionMenus: { semanasHistorialHabitos: weeks } },
      menus: [menu([day('2026-09-21', block(['habitual'])), day('2026-09-28', block(['habitual']))])],
    });
    engine.setMenu({ fechaInicio: '2026-11-16', numSemanas: 1, dias: [] });
    await engine.generate();
    const generated = engine.getMenu();
    assert.equal(generated.adaptacionHabitos.ventanaSemanas, weeks ?? 4);
    assert.equal(generated.adaptacionHabitos.semanasObservadas.mayores.comida, weeks === 12 ? 2 : 0);
  }
});

test('cada nuevo asistente inicia la opción de cenas laborables del bebé desactivada', () => {
  const { engine } = setup();
  engine.setMenu({ bebeSoloCenasLaborables: true });
  engine.start();
  assert.equal(engine.getMenu().bebeSoloCenasLaborables, false);
});

test('la opción manual del bebé elimina solo sus comidas L-V en todas las semanas', async () => {
  const platos = Array.from({ length: 35 }, (_, i) => dish(`compartido-${i}`, { tipoMenu: ['todos'], permiteRepeticion: true }));
  for (const enabled of [undefined, false, true]) {
    const { engine } = setup({ platos, config: { personas: [{ tipo: 'bebe' }] } });
    engine.setMenu({ fechaInicio: '2026-11-11', numSemanas: 2, dias: [], bebeSoloCenasLaborables: enabled });
    await engine.generate();
    for (const current of engine.getMenu().dias) {
      const weekday = new Date(current.fecha + 'T12:00:00').getDay();
      const skipLunch = enabled === true && weekday >= 1 && weekday <= 5;
      assert.equal(current.comida._bebeActivo, !skipLunch, current.fecha);
      assert.equal(current.comida.platosBebe.length > 0, !skipLunch, current.fecha);
      assert.ok(current.comida._mayActivo && current.comida.platosMayores.length > 0, current.fecha);
      assert.ok(current.cena._bebeActivo && current.cena.platosBebe.length > 0, current.fecha);
      assert.ok(current.cena._mayActivo && current.cena.platosMayores.length > 0, current.fecha);
    }
  }
});

test('cenas laborables del bebé conserva las restricciones individuales de días especiales', async () => {
  const platos = Array.from({ length: 20 }, (_, i) => dish(`compartido-${i}`, { tipoMenu: ['todos'], permiteRepeticion: true }));
  const config = { personas: [{ tipo: 'bebe' }], tiposDiaEspecial: [
    { id: 'adultos-fuera', afectaComida: true, afectaCena: true, afectaA: 'mayores' },
    { id: 'bebe-fuera', afectaComida: true, afectaCena: true, afectaA: 'bebe' },
    { id: 'todos-fuera', afectaComida: true, afectaCena: true, afectaA: 'todos' },
  ] };
  const { engine } = setup({ platos, config });
  engine.setMenu({ fechaInicio: '2026-11-09', numSemanas: 1, bebeSoloCenasLaborables: true, dias: [
    { fecha: '2026-11-09', tipoEspecial: 'adultos-fuera' },
    { fecha: '2026-11-10', tipoEspecial: 'bebe-fuera' },
    { fecha: '2026-11-11', tipoEspecial: 'todos-fuera' },
    { fecha: '2026-11-14', tipoEspecial: 'bebe-fuera' },
  ] });
  await engine.generate();
  const [monday, tuesday, wednesday, , , saturday, sunday] = engine.getMenu().dias;
  assert.equal(monday.comida.activo, false);
  assert.equal(monday.cena._mayActivo, false);
  assert.ok(monday.cena._bebeActivo && monday.cena.platosBebe.length > 0);
  for (const current of [tuesday, saturday]) {
    for (const moment of ['comida', 'cena']) {
      assert.equal(current[moment]._bebeActivo, false);
      assert.equal(current[moment].platosBebe.length, 0);
      assert.ok(current[moment]._mayActivo && current[moment].platosMayores.length > 0);
    }
  }
  assert.equal(wednesday.comida.activo, false);
  assert.equal(wednesday.cena.activo, false);
  assert.ok(sunday.comida._bebeActivo && sunday.comida.platosBebe.length > 0);
});


test('la cena propia del bebé excluye platos incompatibles y respeta límites de repetición y facilidad', () => {
  const adult = dish('solo-adultos');
  const own = dish('propio', { tipoMenu: ['bebe'], permiteRepeticion: false, preparacionFacil: true });
  const { engine } = setup({ platos: [adult, own] });
  const used = [];
  const dinner = (catalog, recent = {}, easy = false) => engine.babyDinner(
    [ref(adult.id)], catalog, used, recent, new Set(), {}, {}, easy, 'cena', [], [], 0,
  );
  assert.equal(dinner([adult]).length, 0, 'Adultos incompatible no se copia al bebé');
  assert.equal(dinner([own], { propio: 0 }).length, 0, 'Respeta intervalo de repetición');
  assert.equal(dinner([{ ...own, preparacionFacil: false }], {}, true).length, 0, 'Respeta día fácil');
  assert.equal(dinner([adult, own], {}, true)[0].id, own.id);
  assert.ok(used.includes(own.id));
  assert.equal(dinner([adult, own]).length, 0, 'No repite un plato propio con repetición desactivada');
});

test('afinidad laborable y fin de semana favorece la rutina sin excluir otros días', () => {
  const platos = [dish('laborable'), dish('finde')];
  const { engine, random } = setup({ platos });
  const model = engine.build([menu([
    day('2026-11-02', block(['laborable'])), day('2026-11-09', block(['laborable'])),
    day('2026-11-07', block(['finde'])), day('2026-11-14', block(['finde'])),
  ])], platos, '2026-11-23');
  const tuesday = { fecha: '2026-11-24' };
  const sunday = { fecha: '2026-11-29' };
  assert.ok(weight(engine, platos[0], model, tuesday) > weight(engine, platos[1], model, tuesday));
  assert.ok(weight(engine, platos[1], model, sunday) > weight(engine, platos[0], model, sunday));
  for (const context of [tuesday, sunday]) {
    for (const plato of platos) {
      assert.ok(weight(engine, plato, model, context) >= 1);
      assert.ok(weight(engine, plato, model, context) <= 6);
    }
    random(0);
    assert.equal(engine.choose(platos, [], [], { modelo: model, perfil: 'mayores', momento: 'comida', ...context }).id, 'laborable');
    random(0.999999);
    assert.equal(engine.choose(platos, [], [], { modelo: model, perfil: 'mayores', momento: 'comida', ...context }).id, 'finde');
  }
});

test('facilidad aprende por tipo de jornada y generaliza a platos nuevos solo con dos semanas', () => {
  const platos = [dish('rapido-habitual', { preparacionFacil: true }), dish('lento-habitual', { preparacionFacil: false }),
    dish('rapido-nuevo', { preparacionFacil: true }), dish('lento-nuevo', { preparacionFacil: false })];
  const { engine } = setup({ platos });
  const examples = [
    day('2026-11-02', block(['rapido-habitual'])), day('2026-11-09', block(['rapido-habitual'])),
    day('2026-11-07', block(['lento-habitual'])), day('2026-11-14', block(['lento-habitual'])),
  ];
  const model = engine.build([menu(examples)], platos, '2026-11-23');
  assert.ok(weight(engine, platos[2], model, { fecha: '2026-11-24' }) > weight(engine, platos[3], model, { fecha: '2026-11-24' }));
  assert.ok(weight(engine, platos[3], model, { fecha: '2026-11-29' }) > weight(engine, platos[2], model, { fecha: '2026-11-29' }));
  const sparse = engine.build([menu([examples[0], examples[3]])], platos, '2026-11-23');
  assert.equal(sparse.perfiles.mayores.comida.semanas.size, 2);
  for (const fecha of ['2026-11-24', '2026-11-29']) {
    assert.equal(weight(engine, platos[2], sparse, { fecha }), weight(engine, platos[3], sparse, { fecha }));
  }
});

test('las jornadas cuentan exposiciones desconocidas y no multiplican dificultad por número de platos', () => {
  const platos = [dish('facil-a', { preparacionFacil: true }), dish('facil-b', { preparacionFacil: true })];
  const { engine } = setup({ platos });
  const model = engine.build([menu([
    day('2026-11-02', block(['facil-a', 'facil-b'])), day('2026-11-09', block(['retirado'])),
    day('2026-11-10', block()),
  ])], platos, '2026-11-23');
  const group = model.perfiles.mayores.comida.jornadas.get('laborable');
  assert.equal(group.total, 2);
  assert.equal(group.semanas.size, 2);
  assert.equal(group.preparaciones.get(true), 1);
  assert.equal(group.platos.get('facil-a'), 1);
});

test('las parejas habituales ganan peso solo con dos observaciones y no cuentan referencias duplicadas', () => {
  const platos = [dish('primero-a', { tipoPlato: 'primero' }), dish('primero-b', { tipoPlato: 'primero' }),
    dish('segundo-a', { tipoPlato: 'segundo' }), dish('segundo-b', { tipoPlato: 'segundo' })];
  const { engine } = setup({ platos });
  const examples = [
    day('2026-11-02', block(['primero-a', 'segundo-a', 'segundo-a'])),
    day('2026-11-03', block(['primero-b', 'segundo-b'])),
    day('2026-11-09', block(['primero-a', 'segundo-a'])),
    day('2026-11-10', block(['primero-b', 'segundo-b'])),
  ];
  const model = engine.build([menu(examples)], platos, '2026-11-23');
  assert.equal(model.perfiles.mayores.comida.parejas.get('primero-a').get('segundo-a'), 2);
  assert.equal(model.perfiles.mayores.comida.parejas.get('segundo-a').get('primero-a'), 2);
  assert.equal(model.perfiles.mayores.comida.parejas.get('segundo-a').has('segundo-a'), false);
  const context = { fecha: '2026-11-25', acompananteId: 'primero-a' };
  assert.ok(weight(engine, platos[2], model, context) > weight(engine, platos[3], model, context));
  assert.equal(weight(engine, platos[2], model, { fecha: context.fecha }), weight(engine, platos[3], model, { fecha: context.fecha }));
  const sparse = engine.build([menu([examples[0], examples[3]])], platos, '2026-11-23');
  assert.equal(weight(engine, platos[2], sparse, context), weight(engine, platos[2], sparse, { fecha: context.fecha }));
  assert.equal(weight(engine, platos[2], model, { ...context, perfil: 'bebe' }), 1);
  assert.equal(weight(engine, platos[2], model, { ...context, momento: 'cena' }), 1);
});

test('la pareja aprendida no permite saltar repetición ni facilidad de los complementos', () => {
  const platos = [dish('primero', { tipoPlato: 'primero', tipoMenu: ['todos'] }),
    dish('preferido', { tipoPlato: 'segundo', tipoMenu: ['todos'], permiteRepeticion: false, preparacionFacil: false }),
    dish('alternativa', { tipoPlato: 'segundo', tipoMenu: ['todos'], preparacionFacil: true })];
  const { engine, random } = setup({ platos });
  const model = engine.build([menu(['2026-11-02', '2026-11-09'].map(fecha =>
    day(fecha, block(['primero', 'preferido'], ['primero', 'preferido']))))], platos, '2026-11-23');
  const adultContext = { modelo: model, perfil: 'mayores', momento: 'comida', fecha: '2026-11-25', acompananteId: 'primero' };
  random(0);
  assert.equal(engine.secondAdult(platos, new Map(), {}, 2, 'comida', new Map(), adultContext).id, 'preferido');
  assert.equal(engine.secondAdult(platos, new Map([['preferido', [0]]]), {}, 2, 'comida', new Map(), adultContext).id, 'alternativa');
  assert.equal(engine.secondAdult(platos, new Map(), { preferido: 0 }, 2, 'comida', new Map(), adultContext).id, 'alternativa');
  assert.equal(engine.secondAdult(platos, new Map(), {}, 2, 'comida', new Map(), adultContext, true).id, 'alternativa');
  assert.equal(engine.secondBaby(platos, ['preferido'], {}, 'comida', { ...adultContext, perfil: 'bebe' }).id, 'alternativa');
});

test('el bebé reutiliza en cena ambos platos adultos compatibles preparados al mediodía', () => {
  const platos = [dish('primero', { tipoPlato: 'primero', tipoMenu: ['todos'] }),
    dish('segundo-alternativo', { tipoPlato: 'segundo', tipoMenu: ['todos'] }),
    dish('segundo-cocinado', { tipoPlato: 'segundo', tipoMenu: ['todos'] }),
    dish('cena-adulta', { tipoMenu: ['mayores'] })];
  const { engine, random } = setup({ platos });
  random(0);
  const cooked = [ref('primero'), ref('segundo-cocinado')];
  const selected = engine.babyDinner([ref('cena-adulta')], platos, [], {}, new Set(), {}, {}, false, 'cena', [], cooked, 0);
  assert.deepEqual(copy(selected), cooked, 'No sustituye el segundo cocinado por otro aleatorio');
  const alreadyEaten = engine.babyDinner([ref('cena-adulta')], platos,
    ['segundo-cocinado', 'segundo-cocinado_dia0'], {}, new Set(), {}, {}, false, 'cena', [], cooked, 0);
  assert.ok(alreadyEaten.every(p => p.id !== 'segundo-cocinado'), 'Excluye el plato que ya comió el bebé ese mediodía');
});

test('un catálogo amplio reserva al menos el 80 % al hábito manteniendo alternativas y prioridad de stock', () => {
  const platos = [dish('habitual'), ...Array.from({ length: 20 }, (_, i) => dish(`nuevo-${i}`))];
  platos[20].ingredientes = [{ nombre: 'Tomate' }];
  const { engine, random } = setup({ platos });
  const model = engine.build(twoWeeks('habitual'), platos, '2026-11-23');
  const context = { modelo: model, perfil: 'mayores', momento: 'comida', fecha: '2026-11-25' };
  const counts = new Map();
  for (let i = 0; i < 1000; i++) {
    random((i + 0.5) / 1000);
    const selected = engine.choose(platos, [], [], context);
    counts.set(selected.id, (counts.get(selected.id) || 0) + 1);
    assert.equal(engine.choose(platos, ['tomate'], [], context).id, 'nuevo-19', 'Stock prioritario precede al hábito');
  }
  assert.ok(counts.get('habitual') >= 800, `Habitual elegido ${counts.get('habitual')}/1000`);
  assert.ok(counts.get('habitual') < 1000);
  assert.equal(counts.size, 21, 'Todos los platos nuevos conservan probabilidad positiva');
});

test('reservar peso al hábito no reintroduce platos descartados por elegibilidad', () => {
  const platos = [dish('habitual'), dish('nuevo-a'), dish('nuevo-b')];
  const { engine, random } = setup({ platos });
  const model = engine.build(twoWeeks('habitual'), platos, '2026-11-23');
  const context = { modelo: model, perfil: 'mayores', momento: 'comida', fecha: '2026-11-25' };
  random(0);
  assert.equal(engine.choose(platos.slice(1), [], [], context).id, 'nuevo-a');
  random(0.999999);
  assert.equal(engine.choose(platos.slice(1), [], [], context).id, 'nuevo-b');
});
