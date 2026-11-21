const assert = require('node:assert/strict');
const path = require('node:path');

module.exports = async function testScroll({ browser, origin, output }) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://**/*', route => route.abort());
  await page.goto(origin);
  await page.locator('#screen-app.active').waitFor();
  await page.evaluate(() => {
    document.querySelector('#pwa-banner')?.remove();
    const state = App.getState();
    state.catalogo = Array.from({ length: 35 }, (_, i) => ({ id: `art-${i}`, nombre: `Artículo ${String(i).padStart(2, '0')}`, categoria: 'Otros', unidad: 'UN', activo: true, paqueteMinimo: 1 }));
    state.inventario = state.catalogo.map(a => ({ ...a, cantidad: 2, ubicacion: 'exterior' }));
    state.platos = state.catalogo.map(a => ({ ...a, tipoMenu: ['todos'], tipoComida: ['ambos'], tipoPlato: 'unico', etiquetas: [], ingredientes: [{ nombre: 'Artículo 00', cantidad: 1, unidad: 'UN' }] }));
    state.config.personas = [{ id: 'adulto', tipo: 'mayor', nombre: 'Persona de prueba' }, { id: 'bebe', tipo: 'bebe', nombre: 'Bebé' }];
    state.config.supermercados = [{ id: 'super', nombre: 'Supermercado de prueba', secciones: ['Otros'] }];
    const monday = Dates.startOfWeek(Dates.today());
    window.scrollMenus = Array.from({ length: 15 }, (_, i) => ({ id: `menu-${i}`, estado: 'confirmado', fechaInicio: Dates.addDays(monday, -7 * i), fechaFin: Dates.addDays(monday, 6 - 7 * i), dias: Dates.range(Dates.addDays(monday, -7 * i), 7).map(fecha => ({ fecha, comida: { activo: true, platosMayores: [{ id: 'art-0', nombre: 'Artículo 00' }] }, cena: { activo: false } })) }));
    state.menuActual = window.scrollMenus[0];
    Drive.listMenuFiles = async () => window.scrollMenus.map(m => ({ id: m.id, name: `${m.id}.json` }));
    Drive.readMenuJson = async id => window.scrollMenus.find(m => m.id === id);
    Drive.getFolderIds = () => ({ rootFolderId: 'test', menusFolderId: 'test' });
    Sync.readCompra = async () => null;
    localStorage.setItem('menuapp_compra_actual', JSON.stringify({ id: 'lista-compra', estado: 'pendiente', removidos: {}, items: state.catalogo.map(a => ({ ...a, cantidad: 1, seccion: 'Otros', comprado: false })) }));
  });
  const settle = () => page.waitForTimeout(120);
  const scrollTop = selector => page.locator(selector).evaluate(el => el.scrollTop);
  async function wheelInside(selector, delta = 350) {
    const box = await page.locator(selector).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, delta);
    await settle();
  }
  async function visibleList(selector) {
    await page.locator(`${selector}:not(.hidden)`).waitFor();
    const geometry = await page.locator(selector).evaluate(el => {
      const r = el.getBoundingClientRect(), v = UI.viewportBounds();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(15, r.height / 2));
      return { visible: r.top >= v.top && r.bottom <= v.bottom && r.left >= v.left && r.right <= v.right,
        hit: el.contains(top), height: r.height, scroll: el.scrollHeight > el.clientHeight };
    });
    assert(geometry.visible && geometry.hit && geometry.height >= 24, JSON.stringify(geometry));
    return geometry;
  }
  // Todas las vistas y todas las subsecciones de Configuración, con listas largas.
  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1280, height: 800 }]) {
    await page.setViewportSize(viewport);
    for (const view of ['dashboard', 'menu', 'compra', 'inventario', 'platos', 'articulos', 'historial', 'config']) {
      await page.evaluate(view => App.navigate(view), view);
      await settle();
      const subviews = view === 'config' ? ['familia', 'supermercados', 'dias-especiales', 'generador', 'notificaciones', 'articulos', 'cuenta'] : [null];
      for (const subview of subviews) {
        if (subview) await page.locator(`[data-seccion="${subview}"]`).click();
        const bounds = await page.evaluate(() => {
          const content = document.querySelector('#app-content');
          const header = document.querySelector('.app-header').getBoundingClientRect();
          const nav = document.querySelector('.bottom-nav').getBoundingClientRect();
          content.scrollTop = content.scrollHeight;
          return { overflow: content.scrollWidth > content.clientWidth + 1, bodyScroll: window.scrollY,
            header: header.top, navBottom: nav.bottom, contentBottom: content.getBoundingClientRect().bottom };
        });
        if (bounds.overflow) {
          console.log(await page.locator('#app-content').evaluate(el => [...el.querySelectorAll('*')].filter(x => { const r = x.getBoundingClientRect(); return r.width && r.right > el.getBoundingClientRect().right; }).slice(0, 12).map(x => ({ tag: x.tagName, cls: x.className, width: x.getBoundingClientRect().width, text: x.textContent.slice(0, 50) }))));
          await page.screenshot({ path: path.join(output, `scroll-overflow-${view}.png`) });
        }
        assert(!bounds.overflow, `Desbordamiento ${view}/${subview} a ${viewport.width}px`);
        assert.equal(bounds.bodyScroll, 0);
        assert.equal(bounds.header, 0);
        assert(bounds.navBottom <= viewport.height + 1);
        if (viewport.width < 1024) assert(bounds.contentBottom <= viewport.height - 64 + 1);
      }
    }
    console.log(`PASS scroll global: 8 vistas y 7 subsecciones de Configuración a ${viewport.width}px`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => App.navigate('compra'));
  await page.locator('#compra-extra-input').waitFor();
  await page.locator('#app-content').evaluate(el => { el.scrollTop = 600; });
  const cover = await page.evaluate(() => {
    const bar = document.querySelector('.compra-acciones'), r = bar.getBoundingClientRect();
    const content = document.querySelector('#app-content').getBoundingClientRect();
    return { bg: getComputedStyle(bar).backgroundColor, top: r.top, left: r.left, right: r.right, content: { top: content.top, left: content.left, right: content.right }, hit: bar.contains(document.elementFromPoint(r.left + 4, r.top + 5)) };
  });
  assert.equal(cover.bg, 'rgb(255, 255, 255)');
  assert.equal(cover.top, cover.content.top);
  assert.equal(cover.left, cover.content.left);
  assert.equal(cover.right, cover.content.right);
  assert(cover.hit);
  await page.screenshot({ path: path.join(output, 'scroll-compra-acciones-opacas.png') });
  await page.locator('#compra-extra-input').fill('Artículo');
  await visibleList('#compra-extra-suggestions');
  assert.equal(await page.locator('#compra-extra-suggestions').getAttribute('data-placement'), 'top');
  const parentBefore = await scrollTop('#app-content');
  // Un gesto táctil desplaza opciones sin seleccionar un artículo accidentalmente.
  const cdp = await context.newCDPSession(page);
  const listBox = await page.locator('#compra-extra-suggestions').boundingBox();
  const x = listBox.x + listBox.width / 2, y = listBox.y + listBox.height - 20;
  const valueBefore = await page.locator('#compra-extra-input').inputValue();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let i = 1; i <= 6; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - i * 22 }] });
    await page.waitForTimeout(20);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await settle();
  assert.equal(await page.locator('#compra-extra-input').inputValue(), valueBefore);
  assert(await scrollTop('#compra-extra-suggestions') > 0, 'El gesto táctil desplaza las opciones');
  assert.equal(await scrollTop('#app-content'), parentBefore);
  await cdp.detach();
  await page.locator('#compra-extra-suggestions').evaluate(el => { el.scrollTop = el.scrollHeight; });
  await wheelInside('#compra-extra-suggestions');
  assert.equal(await scrollTop('#app-content'), parentBefore, 'El extremo del desplegable no arrastra Compra');
  // Las flechas desplazan solo la lista y hacen visible la opción activa.
  for (let i = 0; i < 8; i++) await page.locator('#compra-extra-input').press('ArrowDown');
  const activeVisible = await page.locator('#compra-extra-suggestions [aria-selected="true"]').evaluate(el => {
    const a = el.getBoundingClientRect(), b = el.parentElement.getBoundingClientRect();
    return a.top >= b.top - 1 && a.bottom <= b.bottom + 1;
  });
  assert(activeVisible);
  assert.equal(await scrollTop('#app-content'), parentBefore);
  await page.locator('#compra-extra-input').press('Enter');
  assert.equal(await page.locator('#compra-extra-input').inputValue(), '');
  console.log('PASS Compra: franja opaca completa, desplegable arriba, selección por teclado y scroll aislado');

  // Simular el viewport visual del teclado, conservando el layout de 844px.
  // No sustituye una comprobación del teclado físico en Safari/iOS.
  await page.evaluate(() => {
    window.realViewport = window.visualViewport;
    const v = new EventTarget();
    Object.assign(v, { height: 400, width: 390, offsetTop: 20, offsetLeft: 0, scale: 1 });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: v });
    window.dispatchEvent(new Event('resize'));
  });
  await settle();
  await page.locator('#compra-extra-input').fill('Artículo');
  await visibleList('#compra-extra-suggestions');
  await page.screenshot({ path: path.join(output, 'scroll-compra-viewport-teclado.png') });
  await page.evaluate(() => UI.showToast('Aviso visible', 'info', 1000));
  const toastBox = await page.locator('#toast').boundingBox();
  assert(toastBox.y + toastBox.height <= 420, 'Aviso por encima del teclado');
  // Modal de Artículos y categorías, incluyendo el cierre del teclado.
  await page.evaluate(() => { App.navigate('articulos'); Articulos.openForm(); });
  await page.locator('#art-f-cat').fill('a');
  await visibleList('#art-f-cat-sugg');
  const appBefore = await scrollTop('#app-content');
  const modalBody = page.locator('.modal-body');
  await page.locator('#art-f-cat').press('Escape');
  assert.equal(await page.locator('.modal-overlay').count(), 1, 'Escape primero cierra las opciones');
  await modalBody.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await wheelInside('.modal-body');
  assert.equal(await scrollTop('#app-content'), appBefore);
  const footerBox = await page.locator('.modal-footer').boundingBox();
  assert(footerBox.y + footerBox.height <= 420);
  await page.evaluate(() => { window.visualViewport.height = 844; window.visualViewport.offsetTop = 0; window.dispatchEvent(new Event('resize')); });
  await settle();
  await page.locator('#art-f-cat').fill('a');
  await visibleList('#art-f-cat-sugg');
  assert.equal(await page.locator('#art-f-cat-sugg').getAttribute('data-placement'), 'bottom');
  await page.locator('#art-f-cat-sugg [role=option]').first().click();
  assert.notEqual(await page.locator('#art-f-cat').inputValue(), 'a');
  await page.locator('.modal-close').click();
  assert.equal(await page.locator('#screen-app').getAttribute('inert'), null);
  await page.setViewportSize({ width: 320, height: 568 });
  await page.evaluate(() => { window.visualViewport.width = 320; window.visualViewport.height = 568; window.dispatchEvent(new Event('resize')); });
  for (const [section, button] of [['familia', '#cfg-add-persona'], ['supermercados', '#cfg-add-super'], ['dias-especiales', '#cfg-add-esp'], ['articulos', '#cfg-art-btn-add']]) {
    await page.evaluate(() => App.navigate('config'));
    await page.locator(`[data-seccion="${section}"]`).click();
    await page.locator(button).click();
    await page.locator('.modal-body').evaluate(el => { el.scrollTop = el.scrollHeight; });
    const layout = await page.locator('.modal').evaluate(el => ({ width: el.querySelector('.modal-body').scrollWidth <= el.querySelector('.modal-body').clientWidth, bottom: el.getBoundingClientRect().bottom, top: el.getBoundingClientRect().top }));
    assert(layout.width && layout.top >= 0 && layout.bottom <= 844, `Formulario Configuración/${section}`);
    await page.locator('.modal-footer button').first().click();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => { window.visualViewport.width = 390; window.visualViewport.height = 844; window.dispatchEvent(new Event('resize')); });
  // Mismo comportamiento en Despensa e ingredientes de Platos.
  for (const [view, module, input, list] of [
    ['inventario', 'Inventario', '#inv-f-categoria', '#inv-cat-sugg'],
    ['platos', 'Platos', '.pl-ing-nombre', '#pl-ing-sugg-0'],
  ]) {
    await page.evaluate(({ view, module }) => { App.navigate(view); ({ Inventario, Platos })[module].openForm('art-0'); }, { view, module });
    await page.locator(input).fill(view === 'platos' ? 'Artículo' : 'a');
    await visibleList(list);
    await page.locator(input).press('ArrowDown');
    await page.locator(input).press('Enter');
    assert(await page.locator(list).evaluate(el => el.classList.contains('hidden')));
    await page.locator('.modal-close').click();
  }
  console.log('PASS categorías e ingredientes, teclado simulado, modal sin arrastrar fondo y acciones visibles');
  await page.evaluate(() => { Object.defineProperty(window, 'visualViewport', { configurable: true, value: window.realViewport }); window.dispatchEvent(new Event('resize')); });
  // Panel de consulta y días especiales: scroll propio, sin encadenamiento al exterior.
  await page.evaluate(() => App.navigate('compra'));
  await page.locator('#compra-panel-menu-btn').click();
  await page.locator('#compra-panel-menu').scrollIntoViewIfNeeded();
  await page.locator('#compra-panel-menu').evaluate(el => { el.scrollTop = el.scrollHeight; });
  const beforePanel = await scrollTop('#app-content');
  await wheelInside('#compra-panel-menu');
  assert.equal(await scrollTop('#app-content'), beforePanel);
  await page.evaluate(() => App.navigate('menu'));
  await page.locator('#menu-btn-nuevo').click();
  await page.locator('#menu-paso1-next').click();
  await page.locator('.menu-dias-especiales').scrollIntoViewIfNeeded();
  await page.locator('.menu-dias-especiales').evaluate(el => { el.scrollTop = el.scrollHeight; });
  const beforeDays = await scrollTop('#app-content');
  await wheelInside('.menu-dias-especiales');
  assert.equal(await scrollTop('#app-content'), beforeDays);
  // Selector de platos sin doble scroll vertical; búsqueda y último resultado alcanzables.
  await page.locator('#menu-btn-cancelar').click();
  await page.locator('#menu-btn-editar').click();
  await page.locator('[data-momento="comida"][data-perfil="mayores"]').first().click();
  await page.locator('.popup-plato-item').last().scrollIntoViewIfNeeded();
  assert.equal(await page.locator('.popup-plato-list').evaluate(el => el.scrollHeight > el.clientHeight), false);
  assert(await page.locator('.popup-plato-item').last().isVisible());
  await page.locator('.modal-close').click();
  // Fecha y confirmación anidada conservan el bloqueo hasta cerrar el último diálogo.
  await page.evaluate(() => { window.scrollModal = UI.showModal({ title: 'Prueba', content: '<input class="form-control" aria-label="Prueba">' }); Dates.openDatepicker('', '', () => {}); });
  await page.setViewportSize({ width: 844, height: 390 });
  await page.locator('#dp-cancel').scrollIntoViewIfNeeded();
  await page.locator('#dp-cancel').click();
  assert.equal(await page.locator('#screen-app').getAttribute('inert'), '');
  await page.evaluate(() => { window.confirmResult = null; UI.confirm('Prueba').then(value => { window.confirmResult = value; }); });
  await page.locator('#confirm-cancel').click();
  assert.equal(await page.evaluate(() => window.confirmResult), false);
  assert.equal(await page.locator('#screen-app').getAttribute('inert'), '');
  await page.locator('.modal-close').click();
  assert.equal(await page.locator('#screen-app').getAttribute('inert'), null);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => { Object.defineProperty(window, 'visualViewport', { configurable: true, value: undefined }); window.dispatchEvent(new Event('resize')); App.navigate('compra'); });
  await page.locator('#compra-extra-input').fill('Artículo');
  await visibleList('#compra-extra-suggestions');
  console.log('PASS alternativa sin VisualViewport');
  console.log('PASS paneles independientes, selector de platos y bloqueo de diálogos anidados/fecha en horizontal');
  assert.deepEqual(errors, []);
  await context.close();
};
