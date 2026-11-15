const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const root = path.resolve(__dirname, '..');
const output = process.env.MENUAPP_QA_OUTPUT || path.join(os.tmpdir(), 'menuapp-qa');
fs.mkdirSync(output, { recursive: true });
let browser;
let server;

async function comprobarScrollCalendario(page, selector, vista = '#app-content') {
  const calendario = page.locator(selector);
  const medidas = await calendario.evaluate(el => {
    el.scrollTop = 100;
    const vertical = el.scrollTop;
    const altura = { contenido: el.scrollHeight, visible: el.clientHeight };
    const labels = el.querySelector('.menu-cal-labels');
    const columnas = [...el.querySelectorAll('.menu-cal-col')];
    const filas = labels ? [...labels.children].map(fila => fila.getBoundingClientRect()) : [];
    const alineadas = columnas.every(col => [...col.children].every((celda, i) => {
      const rect = celda.getBoundingClientRect();
      return Math.abs(rect.top - filas[i].top) < 1 && Math.abs(rect.height - filas[i].height) < 1;
    }));
    const sinRecortes = [...el.querySelectorAll('.menu-cal-celda')].every(celda => celda.scrollHeight <= celda.clientHeight + 1);
    const etiquetaAntes = labels?.getBoundingClientRect().left;
    el.scrollLeft = el.scrollWidth;
    const horizontal = el.scrollLeft;
    const etiquetasFijas = !labels || Math.abs(labels.getBoundingClientRect().left - etiquetaAntes) < 1;
    el.scrollLeft = 0;
    return { vertical, altura, alineadas, sinRecortes, horizontal, etiquetasFijas, anchoExtra: el.scrollWidth - el.clientWidth, overflowX: getComputedStyle(el).overflowX };
  });
  assert.equal(medidas.vertical, 0, `Scroll vertical interno en ${selector}`);
  assert(medidas.altura.contenido <= medidas.altura.visible + 1, JSON.stringify(medidas));
  assert(medidas.alineadas && medidas.sinRecortes, `Filas alineadas y texto completo: ${JSON.stringify(medidas)}`);
  assert(medidas.overflowX === 'auto' && (medidas.anchoExtra <= 1 || medidas.horizontal > 0) && medidas.etiquetasFijas, `Horizontal y etiquetas: ${JSON.stringify(medidas)}`);
  if (await page.locator(vista).evaluate(el => el.scrollHeight <= el.clientHeight + 1)) return;
  await calendario.evaluate(el => el.scrollIntoView({ block: 'start' }));
  const box = await calendario.boundingBox();
  const antes = await page.locator(vista).evaluate(el => el.scrollTop);
  await page.mouse.move(box.x + box.width / 2, Math.max(65, Math.min(box.y + 80, page.viewportSize().height - 80)));
  await page.mouse.wheel(0, antes > 0 ? -120 : 120);
  await page.waitForFunction(({ vista, antes }) => document.querySelector(vista).scrollTop !== antes, { vista, antes });
  assert.equal(await calendario.evaluate(el => el.scrollTop), 0, 'El gesto vertical desplaza la vista general');
}

(async () => {
  server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404).end(); return; }
      const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
      res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
      res.end(data);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, channel: process.env.MENUAPP_BROWSER_CHANNEL || 'chrome' });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://**/*', route => route.abort());
  await page.goto(origin);
  await page.locator('#screen-app.active').waitFor();
  assert.equal(await page.locator('#screen-login').isVisible(), false);
  assert(await page.locator('#btn-conectar-drive').isVisible());
  console.log('PASS Inicio sin OAuth ni SDK externo');
  await page.evaluate(() => {
    localStorage.setItem('pwa_banner_dismissed', '1');
    document.querySelector('#pwa-banner')?.remove();
    const state = App.getState();
    state.catalogo = [{ id: 'judia', nombre: 'Judías verdes', categoria: 'Frutas y verduras', unidad: 'UN', paqueteMinimo: 1, activo: true }];
    state.inventario = [{ id: 'judia', nombre: 'Judías verdes', categoria: 'Frutas y verduras', cantidad: 2, unidad: 'UN', ubicacion: 'exterior' }];
    state.platos = [{ id: 'pl-judia', nombre: 'Judías verdes', tipoMenu: ['todos'], tipoComida: ['ambos'], tipoPlato: 'unico', etiquetas: [], activo: true, ingredientes: [] }];
    state.config.personas = [{ id: 'adulto', tipo: 'mayor' }, { id: 'bebe', tipo: 'bebe' }];
    state.config.configuracionMenus = { marcadorPrueba: 'conservar' };
    state.config.supermercados = [{ id: 'super', nombre: 'Super de prueba', secciones: ['Otros', 'Lácteos'] }];
    const monday = Dates.startOfWeek(Dates.today());
    const menus = [-28, -21, -14, -7, 0, 7].map((offset, i) => ({
      id: `menu-${i}`, fechaInicio: Dates.addDays(monday, offset), fechaFin: Dates.addDays(monday, offset + 6),
      estado: 'confirmado', generadoEn: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
      dias: Dates.range(Dates.addDays(monday, offset), 7).map(fecha => ({ fecha, diaSemana: Dates.dayName(fecha), comida: { activo: true, platosMayores: [{ id: 'pl-judia', nombre: 'Judías verdes' }] }, cena: { activo: false, platosMayores: [] } })),
    }));
    state.menuActual = menus[4];
    window.testMenus = menus;
    window.menuWrites = [];
    window.failMenuWrite = false;
    Drive.listMenuFiles = async () => menus.map(m => ({ id: m.id, name: `${m.id}.json` }));
    Drive.readMenuJson = async id => menus.find(m => m.id === id);
    Drive.writeMenuJson = async (name, menu, fileId) => {
      if (window.failMenuWrite) throw new Error('Fallo de prueba');
      window.menuWrites.push({ name, menu: structuredClone(menu), fileId });
      const index = menus.findIndex(m => m.id === fileId);
      if (index >= 0) menus[index] = structuredClone(menu);
    };
    Drive.getFolderIds = () => ({ rootFolderId: 'test', menusFolderId: 'test-menu' });
    Drive.initFolderStructure = async () => ({});
    let remote = null;
    Drive.readJson = async name => name === 'lista_compra.json' ? remote : null;
    Drive.writeJson = async (name, data) => { if (name === 'lista_compra.json') remote = structuredClone(data); };
    Drive.listRootJsonFiles = async () => [];
    Drive.listPurchaseFiles = async () => [];
  });
  for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
    await page.setViewportSize(viewport);
    await page.locator('#nav-more-btn').click();
    assert(await page.locator('#nav-more-menu').isVisible());
    const box = await page.locator('#nav-more-menu').boundingBox();
    assert(box.y >= 0 && box.y + box.height <= viewport.height, 'Más dentro del viewport');
    await page.locator('#nav-more-menu button').last().click();
    await page.locator('#view-config.active').waitFor();
    assert.equal(await page.locator('#nav-more-btn').getAttribute('aria-expanded'), 'false');
    console.log(`PASS Más y Configuración ${viewport.width}px`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-seccion="generador"]').click();
  assert.equal(await page.locator('#cfg-g-habitos').inputValue(), '4');
  for (const invalid of ['', '1', '13', '2.5']) {
    await page.locator('#cfg-g-habitos').fill(invalid);
    await page.locator('#cfg-g-guardar').click();
    assert.equal(await page.evaluate(() => App.getState().config.configuracionMenus.semanasHistorialHabitos), undefined);
  }
  await page.locator('#cfg-g-habitos').fill('8');
  await page.locator('#cfg-g-guardar').click();
  await page.waitForFunction(() => App.getState().config.configuracionMenus.semanasHistorialHabitos === 8);
  assert.equal(await page.evaluate(() => App.getState().config.configuracionMenus.marcadorPrueba), 'conservar');
  await page.locator('[data-seccion="familia"]').click();
  await page.locator('[data-seccion="generador"]').click();
  assert.equal(await page.locator('#cfg-g-habitos').inputValue(), '8');
  await page.screenshot({ path: path.join(output, 'configuracion-generador-mobile.png'), fullPage: true });
  console.log('PASS configuración de hábitos: cuatro semanas por defecto, validación 2–12 y conservación al guardar');
  for (const [view, input, card] of [['platos', '#pl-search', '#pl-list'], ['articulos', '#art-search', '#art-list'], ['inventario', '#inv-search', '#inv-list']]) {
    await page.evaluate(view => App.navigate(view), view);
    await page.locator(input).fill('JUDIAS');
    await page.waitForTimeout(350);
    assert((await page.locator(card).innerText()).includes('Judías verdes'), `${view} ignora tildes`);
  }
  console.log('PASS búsquedas platos, artículos y despensa');
  await page.evaluate(() => App.navigate('dashboard'));
  await page.locator('#dashboard-menu-preview .menu-cal-scroll').waitFor();
  await page.evaluate(() => App.navigate('menu'));
  await page.locator('#view-menu .menu-cal-scroll').waitFor();
  await page.waitForTimeout(150);
  const scrollInfo = await page.evaluate(() => {
    const scroll = document.querySelector('#view-menu .menu-cal-scroll');
    const monday = Dates.startOfWeek(Dates.today());
    const target = scroll.querySelector(`[data-fecha="${monday}"]`);
    return { scroll: scroll.scrollLeft, delta: target.getBoundingClientRect().left - scroll.getBoundingClientRect().left - scroll.querySelector('.menu-cal-labels').getBoundingClientRect().width };
  });
  assert.equal(scrollInfo.scroll, 0);
  assert(Math.abs(scrollInfo.delta) < 2, JSON.stringify(scrollInfo));
  const visibleDates = await page.locator('#view-menu .menu-cal-col').evaluateAll(cols => cols.map(col => col.dataset.fecha));
  const monday = await page.evaluate(() => Dates.startOfWeek(Dates.today()));
  assert.equal(visibleDates.length, 14);
  assert(visibleDates.every(date => date >= monday), 'Menú excluye todas las semanas anteriores');
  console.log('PASS Menú muestra solo semana actual y futura, e Inicio conserva su calendario');
  for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
    await page.setViewportSize(viewport);
    assert.equal(await page.locator('#menu-editar-seleccion option').count(), 2);
    assert(await page.locator('#menu-btn-historial').isVisible());
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: path.join(output, `menu-semanas-${viewport.width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  // Edición de futuro: error recuperable, guardado y conservación de la semana activa.
  await page.locator('#menu-editar-seleccion').selectOption('1');
  await page.locator('#menu-btn-editar').click();
  assert.equal(await page.locator('#menu-btn-confirmar').innerText(), 'Guardar cambios');
  const futureCell = page.locator('#view-menu [data-momento="cena"][data-perfil="mayores"]').first();
  await futureCell.click();
  await page.waitForTimeout(120);
  await page.locator('.popup-plato-item').first().click();
  await page.evaluate(() => { window.failMenuWrite = true; });
  await page.locator('#menu-btn-confirmar').click();
  await page.waitForFunction(() => document.querySelector('#menu-btn-confirmar')?.disabled === false);
  assert((await page.locator('#view-menu').innerText()).includes('Judías verdes'));
  assert.equal(await page.evaluate(() => window.menuWrites.length), 0);
  await page.evaluate(() => { window.failMenuWrite = false; });
  await page.locator('#menu-btn-confirmar').click();
  await page.locator('#menu-editar-seleccion').waitFor();
  assert.deepEqual(await page.evaluate(() => ({
    active: App.getState().menuActual.id, written: window.menuWrites.at(-1).fileId,
    dish: window.menuWrites.at(-1).menu.dias[0].cena.platosMayores[0].nombre,
    privateMetadata: '_fileId' in window.menuWrites.at(-1).menu,
  })), { active: 'menu-4', written: 'menu-5', dish: 'Judías verdes', privateMetadata: false });
  // La semana actual sigue editable y cancelar nunca escribe.
  await page.locator('#menu-btn-editar').click();
  const currentDate = await page.locator('#view-menu .menu-cal-col').first().getAttribute('data-fecha');
  assert.equal(currentDate, monday);
  await page.locator('#menu-btn-cancelar').click();
  await page.locator('#menu-editar-seleccion').waitFor();
  assert.equal(await page.evaluate(() => window.menuWrites.length), 1);
  // El historial empieza por la actual; después vienen las anteriores de reciente a antigua.
  await page.locator('#menu-btn-historial').click();
  await page.locator('.hist-menu-card').first().waitFor();
  const historyLabels = await page.locator('.hist-menu-card .cfg-item-nombre').allTextContents();
  const expectedDates = await page.evaluate(() => [0, -7, -14, -21, -28, 7].map(offset => Dates.format(Dates.addDays(Dates.startOfWeek(Dates.today()), offset), 'short')));
  historyLabels.forEach((label, i) => assert(label.includes(expectedDates[i]), label));
  await page.screenshot({ path: path.join(output, 'historial-semanas-mobile.png'), fullPage: true });
  await page.locator('.hist-menu-card').nth(1).click();
  await page.locator('.modal-footer button').click();
  const pastCell = page.locator('#view-menu [data-momento="cena"][data-perfil="mayores"]').first();
  await pastCell.click();
  await page.waitForTimeout(120);
  await page.locator('.popup-plato-item').first().click();
  await page.locator('#menu-btn-confirmar').click();
  await page.locator('#view-historial.active .hist-menu-card').first().waitFor();
  assert.deepEqual(await page.evaluate(() => ({
    active: App.getState().menuActual.id, written: window.menuWrites.at(-1).fileId,
    status: window.menuWrites.at(-1).menu.estado,
    dish: window.menuWrites.at(-1).menu.dias[0].cena.platosMayores[0].nombre,
  })), { active: 'menu-4', written: 'menu-3', status: 'confirmado', dish: 'Judías verdes' });
  await page.locator('.hist-menu-card').nth(1).click();
  assert((await page.locator('.modal-body').innerText()).includes('Judías verdes'));
  await page.locator('.modal-footer button').click();
  await page.locator('#menu-btn-cancelar').click();
  await page.locator('#view-historial.active .hist-menu-card').first().waitFor();
  assert.equal(await page.evaluate(() => window.menuWrites.length), 2);
  await page.evaluate(() => App.navigate('menu'));
  await page.locator('#menu-btn-nuevo').waitFor();
  console.log('PASS editar futuro e histórico, guardar en archivo original, reintentar errores y cancelar sin escrituras');
  await page.locator('#menu-btn-nuevo').click();
  await page.locator('#menu-paso1-next').click();
  assert.equal(await page.locator('#menu-bebe-solo-cenas').isChecked(), false);
  await page.locator('#menu-bebe-solo-cenas').check();
  await page.screenshot({ path: path.join(output, 'menu-bebe-cenas-mobile.png'), fullPage: true });
  await page.locator('#menu-paso2-next').click();
  await page.locator('#menu-btn-back').click();
  assert.equal(await page.locator('#menu-bebe-solo-cenas').isChecked(), true);
  await page.locator('#menu-paso2-next').click();
  await page.locator('#menu-paso3-skip').click();
  await page.locator('#menu-btn-confirmar').waitFor();
  assert((await page.locator('.menu-paso-tabla').innerText()).includes('Se han priorizado vuestros hábitos'));
  assert((await page.locator('.menu-paso-tabla').innerText()).includes('8 semanas'));
  const babyCells = await page.locator('#view-menu [data-perfil="bebe"]').evaluateAll(cells => cells.map(cell => ({
    date: cell.dataset.fecha, moment: cell.dataset.momento, text: cell.textContent,
    editable: cell.classList.contains('menu-cal-celda--edit'),
  })));
  assert.equal(babyCells.length, 14);
  for (const cell of babyCells) {
    const weekday = new Date(cell.date + 'T12:00:00').getDay();
    const skipped = cell.moment === 'comida' && weekday > 0 && weekday < 6;
    assert.equal(cell.editable, true, JSON.stringify(cell));
    if (skipped) assert.equal(cell.text, '+ Añadir');
  }
  const exceptionCell = babyCells.find(cell => cell.moment === 'comida' &&
    new Date(cell.date + 'T12:00:00').getDay() > 0 && new Date(cell.date + 'T12:00:00').getDay() < 6);
  assert(exceptionCell, 'el borrador ofrece una comida laborable de bebé para editar');
  const lunchBaby = page.locator(`#view-menu .menu-cal-celda[data-fecha="${exceptionCell.date}"][data-momento="comida"][data-perfil="bebe"]`);
  assert((await lunchBaby.getAttribute('title')).includes('pulsa para añadir'));
  await lunchBaby.click();
  await page.waitForTimeout(120);
  await page.locator('#popup-plato-search').fill('judias');
  await page.locator('.popup-plato-item').first().click();
  assert.notEqual(await lunchBaby.innerText(), '+ Añadir');
  assert.equal(await lunchBaby.getAttribute('title'), 'Añadido manualmente al menú');
  await page.locator('#menu-btn-cancelar').click();
  await page.locator('#menu-btn-nuevo').click();
  await page.locator('#menu-paso1-next').click();
  assert.equal(await page.locator('#menu-bebe-solo-cenas').isChecked(), false);
  await page.locator('#menu-btn-cancelar').click();
  console.log('PASS asistente usa ventana configurada y opción bebé manual persistente dentro del borrador');
  await page.evaluate(() => {
    window.originalMenuList = Drive.listMenuFiles;
    Drive.listMenuFiles = async () => (await window.originalMenuList()).filter(file => !['menu-4', 'menu-5'].includes(file.id));
    App.navigate('menu');
  });
  await page.locator('#view-menu .menu-cal-scroll').waitFor();
  await page.waitForTimeout(150);
  const emptyWeek = await page.evaluate(() => {
    const monday = Dates.startOfWeek(Dates.today());
    const scroll = document.querySelector('#view-menu .menu-cal-scroll');
    const target = scroll.querySelector(`[data-fecha="${monday}"]`);
    return {
      count: [...scroll.querySelectorAll('[data-fecha]')].filter(el => el.dataset.fecha >= monday).length,
      delta: target.getBoundingClientRect().left - scroll.getBoundingClientRect().left - scroll.querySelector('.menu-cal-labels').getBoundingClientRect().width,
      dateLabel: Dates.format(monday, 'numshort'),
    };
  });
  assert.equal(emptyWeek.count, 7);
  assert(Math.abs(emptyWeek.delta) < 2);
  await page.locator('#menu-btn-kpi').click();
  assert(!(await page.locator('.modal').innerText()).includes(emptyWeek.dateLabel), 'Los días vacíos no se evalúan como comidas planificadas');
  await page.locator('.modal-close').click();
  await page.evaluate(() => { Drive.listMenuFiles = window.originalMenuList; delete window.originalMenuList; });
  console.log('PASS pestaña Menú abre semana actual vacía si solo hay histórico, sin falsos KPI');
  await page.evaluate(() => {
    const items = Array.from({ length: 45 }, (_, i) => ({ id: `item-${i}`, nombre: i === 44 ? 'Último Lácteo' : `Artículo ${i + 1}`, cantidad: 2, unidad: 'UN', seccion: i === 44 ? 'Lácteos' : 'Otros', paqueteMinimo: 1, comprado: false }));
    localStorage.setItem('menuapp_compra_actual', JSON.stringify({ id: 'lista-compra', items, removidos: {}, estado: 'pendiente' }));
    App.navigate('compra');
  });
  await page.locator('#compra-btn-guardar').waitFor();
  await page.evaluate(() => { const el = document.getElementById('app-content'); el.scrollTop = 700; });
  const actionBox = await page.locator('.compra-acciones').boundingBox();
  const contentBox = await page.locator('#app-content').boundingBox();
  assert(actionBox.y >= contentBox.y && actionBox.y <= contentBox.y + 17, `acciones sticky ${JSON.stringify({ actionBox, contentBox })}`);
  await page.locator('#compra-btn-ir').click();
  await page.locator('.compra-super-btn').click();
  const last = page.locator('.compra-item-modo').last();
  await last.scrollIntoViewIfNeeded();
  const lastBox = await last.boundingBox();
  const navBox = await page.locator('.bottom-nav').boundingBox();
  assert(lastBox.y + lastBox.height <= navBox.y, 'Último artículo accesible por encima navegación');
  await last.locator('.compra-check-btn').click();
  assert.equal(await page.locator('.compra-progreso-num').innerText(), '1/45');
  await last.locator('.compra-nodisponible-btn').click();
  assert.equal(await page.locator('.compra-progreso-num').innerText(), '0/45');
  await page.screenshot({ path: path.join(output, 'compra-mobile.png'), fullPage: true });
  console.log('PASS compra larga, controles sticky, último artículo y progreso no-disponible');
  assert.deepEqual(errors, [], `Errores JS: ${errors.join('; ')}`);
  await page.evaluate(() => App.navigate('historial'));
  await page.locator('#hist-analizar:not([disabled])').waitFor();
  await page.locator('#hist-analizar').click();
  await page.locator('.modal[role=dialog]').waitFor();
  await page.waitForTimeout(100);
  assert(await page.locator('.modal-title').isVisible());
  assert.equal(await page.locator('.modal').evaluate(el => el.scrollTop), 0, 'El informe abre desde el principio');
  assert((await page.locator('.modal').innerText()).includes('Judías verdes'));
  await page.screenshot({ path: path.join(output, 'historial-mobile.png'), fullPage: true });
  await page.locator('.modal-close').click();
  console.log('PASS análisis historial con datos de prueba');
  // Nombres largos y pantallas bajas: el calendario crece sin scroll vertical propio.
  await page.evaluate(() => {
    const largo = 'Lubina al horno con patatas y cebolla, acompañada de verduras asadas y ensalada de tomate con aceite de oliva';
    for (const menu of window.testMenus) {
      menu.dias[0].comida.platosMayores = [{ id: 'largo', nombre: largo }];
      menu.dias[0].comida.platosBebe = [{ id: 'largo-bebe', nombre: largo }];
      menu.dias[6].cena = { activo: true, platosMayores: [{ id: 'largo-cena', nombre: largo }] };
    }
  });
  for (const viewport of [{ width: 390, height: 560 }, { width: 844, height: 390 }, { width: 1280, height: 800 }]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => App.navigate('menu'));
    await page.locator('#view-menu .menu-cal-scroll').waitFor();
    await comprobarScrollCalendario(page, '#view-menu .menu-cal-scroll');
    await page.screenshot({ path: path.join(output, `calendario-completo-${viewport.width}.png`), fullPage: true });
    await page.evaluate(() => App.navigate('dashboard'));
    await page.locator('#dashboard-menu-preview .menu-cal-scroll').waitFor();
    await comprobarScrollCalendario(page, '#dashboard-menu-preview .menu-cal-scroll');
    await page.evaluate(() => App.navigate('menu'));
    await page.locator('#menu-btn-editar').click();
    await comprobarScrollCalendario(page, '#view-menu .menu-cal-scroll');
    await page.locator('#menu-btn-cancelar').click();
    await page.locator('#menu-btn-historial').click();
    await page.locator('.hist-menu-card').first().click();
    await comprobarScrollCalendario(page, '.menu-historial-scroll', '.modal-overlay');
    assert.equal(await page.locator('.modal').evaluate(el => el.scrollHeight > el.clientHeight), false);
    await page.locator('.modal-close').click();
    console.log(`PASS calendario completo, filas alineadas, scroll general vertical y horizontal propio en cuatro vistas a ${viewport.width}x${viewport.height}`);
  }
  await page.evaluate(() => {
    App.getState().config.personas = [{ id: 'adulto', tipo: 'mayor' }];
    App.navigate('menu');
  });
  await page.locator('#view-menu .menu-cal-scroll').waitFor();
  await comprobarScrollCalendario(page, '#view-menu .menu-cal-scroll');
  await page.locator('#menu-btn-editar').click();
  await comprobarScrollCalendario(page, '#view-menu .menu-cal-scroll');
  await page.locator('#menu-btn-cancelar').click();
  console.log('PASS calendario sin filas de bebé conserva altura completa y alineación');
  assert.deepEqual(errors, [], `Errores JS: ${errors.join('; ')}`);
  // Segunda visita real sin red: JS, CSS, iconos y caché local desde el Service Worker.
  const offlineContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const offlinePage = await offlineContext.newPage();
  await offlinePage.route('https://**/*', route => route.abort());
  await offlinePage.goto(origin);
  await offlinePage.locator('#screen-app.active').waitFor();
  await offlinePage.evaluate(async () => {
    await navigator.serviceWorker.ready;
    await Storage.set('cache_catalogo.json', [{ id: 'local', nombre: 'Artículo offline', categoria: 'Otros', unidad: 'UN' }]);
  });
  await offlinePage.reload();
  await offlinePage.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await offlineContext.setOffline(true);
  await offlinePage.reload({ waitUntil: 'domcontentloaded' });
  await offlinePage.locator('#screen-app.active').waitFor();
  await offlinePage.evaluate(() => App.navigate('articulos'));
  assert((await offlinePage.locator('#art-list').innerText()).includes('Artículo offline'));
  console.log('PASS recarga offline real con Service Worker y datos locales');

})().catch(err => { console.error(err); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
});
