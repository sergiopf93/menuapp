/**
 * MenuApp — Módulo de Lista de la Compra y Modo Compra (Fase 4)
 *
 * Flujo:
 *   1. Genera la lista a partir del menú confirmado
 *   2. El usuario revisa y ajusta
 *   3. Selecciona supermercado → la lista se ordena por secciones
 *   4. Modo compra: marca artículos uno a uno
 *   5. Cierra la compra → actualiza el inventario automáticamente
 *
 * Lógica de generación:
 *   - Para cada plato del menú, recoge sus ingredientes del catálogo
 *   - Suma cantidades si el mismo artículo aparece en varios platos
 *   - Resta el stock disponible en inventario
 *   - Aplica el paquete mínimo de compra
 *   - Añade indicador "ya en casa" si hay stock suficiente
 *
 * @module Compra
 */

const Compra = (() => {

  // ── Estado local ─────────────────────────────────────────────────
  let _vista = 'lista';        // 'lista' | 'seleccion-super' | 'modo-compra'
  let _compraActual = null;    // objeto compra en curso
  let _superId = null;         // supermercado seleccionado

  // ── API pública ──────────────────────────────────────────────────

  function render() {
    _ensureView();
    const view = document.getElementById('view-compra');
    if (!view) return;

    // Intenta restaurar compra en curso desde el estado
    const state = App.getState();
    if (state.compraActual) {
      _compraActual = state.compraActual;
      _vista = _compraActual.estado === 'en_curso' ? 'modo-compra' : 'lista';
    }

    _renderVista(view);
  }

  // ── Router de vistas ─────────────────────────────────────────────

  function _renderVista(view) {
    if (!view) view = document.getElementById('view-compra');
    switch (_vista) {
      case 'lista':            _renderLista(view);         break;
      case 'seleccion-super':  _renderSeleccionSuper(view); break;
      case 'modo-compra':      _renderModoCompra(view);    break;
    }
  }

  // ── Vista 1: Lista de revisión ───────────────────────────────────

  async function _renderLista(view) {
    const state   = App.getState();
    const menuActual = state.menuActual || await _buscarMenuActual();

    if (!menuActual) {
      view.innerHTML = `
        <div class="module-header">
          <h1 class="module-title">Compra</h1>
        </div>
        <div class="empty-state">
          <div class="empty-state-icon">🛒</div>
          <h2 class="empty-state-title">Sin menú activo</h2>
          <p class="empty-state-desc">Genera y confirma un menú primero para crear la lista de la compra.</p>
          <button class="btn btn-primary" onclick="App.navigate('menu')">Ir al generador de menú</button>
        </div>`;
      return;
    }

    // Genera la lista si no hay compra en curso para este menú
    if (!_compraActual || _compraActual.menuId !== menuActual.id) {
      _compraActual = await _generarListaCompra(menuActual);
      App.getState().compraActual = _compraActual;
    }

    const items = _compraActual.items || [];
    const aComprar  = items.filter(i => !i.enDespensa && !i.comprado);
    const enCasa    = items.filter(i => i.enDespensa);
    const extras    = items.filter(i => i.esExtra);

    view.innerHTML = `
      <div class="module-header">
        <h1 class="module-title">Lista de la compra</h1>
        <button class="btn btn-secondary btn-sm" id="compra-btn-regenerar">↺ Regenerar</button>
      </div>

      <p class="text-sm text-muted" style="margin-bottom:var(--space-4)">
        Menú del ${Dates.format(menuActual.fechaInicio,'numeric')} al ${Dates.format(menuActual.fechaFin,'numeric')}.
        Revisa y ajusta antes de ir al supermercado.
      </p>

      <!-- Paneles consulta rápida -->
      <div class="compra-paneles-consulta">
        <button class="btn btn-secondary btn-sm" id="compra-panel-menu-btn">📅 Ver menú</button>
        <button class="btn btn-secondary btn-sm" id="compra-panel-inv-btn">📦 Ver despensa</button>
      </div>
      <div id="compra-panel-menu" class="menu-info-panel hidden"></div>
      <div id="compra-panel-inv"  class="menu-info-panel hidden"></div>

      <!-- Resumen -->
      <div class="inv-summary-bar" style="margin-bottom:var(--space-4)">
        <span class="badge badge-blue">${aComprar.length} a comprar</span>
        ${enCasa.length>0?`<span class="badge badge-green">✓ ${enCasa.length} en casa</span>`:''}
      </div>

      <!-- Items a comprar -->
      ${aComprar.length > 0 ? `
        <div class="dashboard-section">
          <h2 class="section-title">A comprar</h2>
          <div id="compra-items-lista">
            ${aComprar.map(item => _buildItemRevision(item)).join('')}
          </div>
        </div>` : `
        <div class="card card-empty">
          <p>✓ Tienes todos los ingredientes en casa.</p>
        </div>`}

      <!-- Items en casa -->
      ${enCasa.length > 0 ? `
        <div class="dashboard-section">
          <details class="compra-details">
            <summary class="section-title" style="cursor:pointer">
              ✓ Ya tienes en casa (${enCasa.length})
            </summary>
            <div style="margin-top:var(--space-3)">
              ${enCasa.map(item => _buildItemRevision(item, true)).join('')}
            </div>
          </details>
        </div>` : ''}

      <!-- Añadir artículo extra -->
      <div class="dashboard-section">
        <h2 class="section-title">Añadir artículo extra</h2>
        <div class="compra-add-extra">
          <input class="form-control" id="compra-extra-input" type="text"
                 placeholder="Nombre del artículo..." autocomplete="off"
                 style="flex:1"/>
          <button class="btn btn-secondary" id="compra-btn-extra">Añadir</button>
        </div>
      </div>

      <!-- Botón ir a comprar -->
      <div style="margin-top:var(--space-6)">
        <button class="btn btn-primary btn-full" id="compra-btn-ir" ${aComprar.length===0?'disabled':''}>
          🛒 Ir a comprar →
        </button>
      </div>
    `;

    _bindListaEvents();
  }

  function _buildItemRevision(item, enCasa=false) {
    return `
      <div class="compra-item-rev ${enCasa?'compra-item-encasa':''}" data-id="${item.id}">
        <div class="compra-item-info">
          <span class="compra-item-nombre">${UI.escapeHtml(item.nombre)}</span>
          <span class="compra-item-meta">${item.cantidad} ${item.unidad} · ${UI.escapeHtml(item.seccion)}</span>
        </div>
        <div class="compra-item-actions">
          ${!enCasa ? `
            <button class="inv-qty-btn compra-qty-minus" data-id="${item.id}">−</button>
            <div class="inv-qty-display" style="min-width:40px">
              <span class="inv-qty-value compra-qty-val" data-id="${item.id}">${item.cantidad}</span>
              <span class="inv-qty-unit">${item.unidad}</span>
            </div>
            <button class="inv-qty-btn inv-qty-plus compra-qty-plus" data-id="${item.id}">+</button>
            <button class="inv-action-btn inv-action-delete compra-item-rm" data-id="${item.id}" style="margin-left:var(--space-1)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
            </button>` : `<span class="badge badge-green">En casa</span>`}
        </div>
      </div>`;
  }

  function _bindListaEvents() {
    // Panel menú
    const panelMenuBtn = document.getElementById('compra-panel-menu-btn');
    const panelMenuEl  = document.getElementById('compra-panel-menu');
    panelMenuBtn?.addEventListener('click', () => {
      if (panelMenuEl.classList.contains('hidden')) {
        const menu = App.getState().menuActual;
        if (!menu) { panelMenuEl.innerHTML='<p class="text-sm text-muted">Sin menú activo.</p>'; }
        else {
          const dias = menu.dias || [];
          panelMenuEl.innerHTML = `
            <div class="menu-panel-content">
              <h3 class="section-title" style="margin-bottom:var(--space-3)">📅 Menú activo</h3>
              ${dias.map(d=>`
                <div class="menu-panel-item" style="flex-direction:column;align-items:flex-start">
                  <strong style="font-size:var(--font-size-xs)">${Dates.format(d.fecha,'short')}</strong>
                  ${['comida','cena'].map(m=>{
                    const b=d[m]; if(!b?.activo) return '';
                    const pl=(b.platosMayores||[]).map(p=>p.nombre).join(' + ');
                    return pl?`<span class="text-xs text-muted">${m==='comida'?'🍽':'🌙'} ${pl}</span>`:'';
                  }).join('')}
                </div>`).join('')}
            </div>`;
        }
        panelMenuEl.classList.remove('hidden');
        panelMenuBtn.textContent = '📅 Ocultar menú';
      } else {
        panelMenuEl.classList.add('hidden');
        panelMenuBtn.textContent = '📅 Ver menú';
      }
    });

    // Panel inventario
    const panelInvBtn = document.getElementById('compra-panel-inv-btn');
    const panelInvEl  = document.getElementById('compra-panel-inv');
    panelInvBtn?.addEventListener('click', () => {
      if (panelInvEl.classList.contains('hidden')) {
        const inv = App.getState().inventario || [];
        panelInvEl.innerHTML = `
          <div class="menu-panel-content">
            <h3 class="section-title" style="margin-bottom:var(--space-3)">📦 Despensa</h3>
            ${inv.length===0?'<p class="text-sm text-muted">Vacía.</p>':
              inv.map(i=>`<div class="menu-panel-item">
                <span class="text-sm">${UI.escapeHtml(i.nombre)}</span>
                <span class="text-xs text-muted">${i.cantidad} ${i.unidad}</span>
              </div>`).join('')}
          </div>`;
        panelInvEl.classList.remove('hidden');
        panelInvBtn.textContent = '📦 Ocultar despensa';
      } else {
        panelInvEl.classList.add('hidden');
        panelInvBtn.textContent = '📦 Ver despensa';
      }
    });

    document.getElementById('compra-btn-regenerar')?.addEventListener('click', async () => {
      const state = App.getState();
      const menu = state.menuActual || await _buscarMenuActual();
      if (!menu) return;
      _compraActual = await _generarListaCompra(menu);
      App.getState().compraActual = _compraActual;
      _renderVista();
    });

    document.getElementById('compra-btn-ir')?.addEventListener('click', () => {
      _vista = 'seleccion-super';
      _renderVista();
    });

    // Cantidad rápida
    document.getElementById('compra-items-lista')?.addEventListener('click', (e) => {
      const id = e.target.closest('[data-id]')?.dataset.id;
      if (!id) return;
      const item = _compraActual.items.find(i=>i.id===id);
      if (!item) return;

      if (e.target.closest('.compra-qty-plus')) {
        item.cantidad = parseFloat((item.cantidad + (item.paqueteMinimo||1)).toFixed(2));
        document.querySelector(`.compra-qty-val[data-id="${id}"]`).textContent = item.cantidad;
      } else if (e.target.closest('.compra-qty-minus')) {
        item.cantidad = Math.max(0, parseFloat((item.cantidad - (item.paqueteMinimo||1)).toFixed(2)));
        document.querySelector(`.compra-qty-val[data-id="${id}"]`).textContent = item.cantidad;
      } else if (e.target.closest('.compra-item-rm')) {
        _compraActual.items = _compraActual.items.filter(i=>i.id!==id);
        e.target.closest('.compra-item-rev')?.remove();
        App.getState().compraActual = _compraActual;
      }
    });

    // Artículo extra
    const extraInput = document.getElementById('compra-extra-input');
    document.getElementById('compra-btn-extra')?.addEventListener('click', () => {
      const nombre = extraInput?.value.trim();
      if (!nombre) return;
      const nuevo = {
        id: `extra-${Date.now()}`,
        nombre,
        cantidad: 1,
        unidad: 'UN',
        seccion: 'Otros',
        paqueteMinimo: 1,
        enDespensa: false,
        comprado: false,
        noDisponible: false,
        esExtra: true,
      };
      _compraActual.items.push(nuevo);
      App.getState().compraActual = _compraActual;
      if (extraInput) extraInput.value = '';
      // Añade a la lista sin re-renderizar todo
      const lista = document.getElementById('compra-items-lista');
      if (lista) {
        const div = document.createElement('div');
        div.innerHTML = _buildItemRevision(nuevo);
        lista.appendChild(div.firstElementChild);
      }
      UI.showToast(`${nombre} añadido`, 'success');
    });

    extraInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('compra-btn-extra')?.click();
    });
  }

  // ── Vista 2: Selección de supermercado ───────────────────────────

  function _renderSeleccionSuper(view) {
    const config = App.getState().config || {};
    const supers = config.supermercados || [];

    view.innerHTML = `
      <div class="module-header">
        <button class="btn-icon" id="compra-back-lista" style="color:var(--color-text)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <h1 class="module-title">¿En qué supermercado?</h1>
      </div>
      <p class="text-sm text-muted" style="margin-bottom:var(--space-5)">
        La lista se ordenará según el recorrido de la tienda elegida.
      </p>
      <div class="compra-super-lista">
        ${supers.map(s => `
          <button class="compra-super-btn ${_superId===s.id?'active':''}" data-id="${s.id}">
            <span class="compra-super-nombre">🛒 ${UI.escapeHtml(s.nombre)}</span>
            <span class="compra-super-meta">${s.secciones.length} secciones</span>
          </button>`).join('')}
      </div>
      ${supers.length === 0 ? `
        <div class="card card-empty">
          <p class="text-sm">No tienes supermercados configurados.<br>Ve a <strong>Config</strong> para añadirlos.</p>
        </div>` : ''}
    `;

    document.getElementById('compra-back-lista')?.addEventListener('click',()=>{ _vista='lista'; _renderVista(); });
    document.querySelectorAll('.compra-super-btn').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        _superId = btn.dataset.id;
        _compraActual.supermercadoId = _superId;
        _ordenarPorSuper();
        _compraActual.estado = 'en_curso';
        App.getState().compraActual = _compraActual;
        _vista = 'modo-compra';
        _renderVista();
      });
    });
  }

  // ── Vista 3: Modo compra ─────────────────────────────────────────

  function _renderModoCompra(view) {
    const items = _compraActual.items.filter(i=>!i.enDespensa);
    const comprados  = items.filter(i=>i.comprado).length;
    const total      = items.length;
    const pct = total>0 ? Math.round(comprados/total*100) : 0;

    // Agrupa por sección
    const grupos = {};
    items.forEach(item=>{
      const sec = item.seccion||'Otros';
      if (!grupos[sec]) grupos[sec]=[];
      grupos[sec].push(item);
    });

    view.innerHTML = `
      <div class="compra-modo-header">
        <div class="compra-modo-titulo">
          <button class="btn-icon" id="compra-back-super" style="color:var(--color-text)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <h1 class="module-title">Modo compra</h1>
        </div>
        <div class="compra-progreso">
          <span class="compra-progreso-num">${comprados}/${total}</span>
          <div class="compra-progreso-bar">
            <div class="compra-progreso-fill" style="width:${pct}%"></div>
          </div>
        </div>
      </div>

      <div id="compra-modo-lista">
        ${Object.entries(grupos).map(([seccion, sitems]) => `
          <div class="compra-seccion">
            <h2 class="section-title compra-seccion-titulo">${UI.escapeHtml(seccion)}</h2>
            ${sitems.map(item => _buildItemCompra(item)).join('')}
          </div>`).join('')}
      </div>

      <div class="compra-modo-footer">
        <button class="btn btn-primary btn-full" id="compra-btn-cerrar">
          ✓ Cerrar compra y actualizar despensa
        </button>
      </div>
    `;

    _bindModoCompraEvents();
  }

  function _buildItemCompra(item) {
    return `
      <div class="compra-item-modo ${item.comprado?'compra-item-comprado':''} ${item.noDisponible?'compra-item-nodisponible':''}"
           data-id="${item.id}">
        <button class="compra-check-btn" data-id="${item.id}" aria-label="Marcar como comprado">
          <div class="compra-check ${item.comprado?'compra-check--on':''}"></div>
        </button>
        <div class="compra-item-info" style="flex:1">
          <span class="compra-item-nombre">${UI.escapeHtml(item.nombre)}</span>
          <span class="compra-item-meta">${item.cantidad} ${item.unidad}</span>
        </div>
        <button class="compra-nodisponible-btn ${item.noDisponible?'active':''}" data-id="${item.id}"
                title="No disponible en este super">
          ${item.noDisponible?'🚫':'✕'}
        </button>
      </div>`;
  }

  function _bindModoCompraEvents() {
    document.getElementById('compra-back-super')?.addEventListener('click',()=>{ _vista='seleccion-super'; _renderVista(); });

    document.getElementById('compra-modo-lista')?.addEventListener('click',(e)=>{
      const id = e.target.closest('[data-id]')?.dataset.id;
      if (!id) return;
      const item = _compraActual.items.find(i=>i.id===id);
      if (!item) return;

      if (e.target.closest('.compra-check-btn')) {
        item.comprado = !item.comprado;
        item.noDisponible = false;
        _actualizarItemUI(item);
        _actualizarProgreso();
        App.getState().compraActual = _compraActual;
      } else if (e.target.closest('.compra-nodisponible-btn')) {
        item.noDisponible = !item.noDisponible;
        item.comprado = false;
        _actualizarItemUI(item);
        App.getState().compraActual = _compraActual;
      }
    });

    document.getElementById('compra-btn-cerrar')?.addEventListener('click', _cerrarCompra);
  }

  function _actualizarItemUI(item) {
    const el = document.querySelector(`.compra-item-modo[data-id="${item.id}"]`);
    if (!el) return;
    el.className = [
      'compra-item-modo',
      item.comprado     ? 'compra-item-comprado'     : '',
      item.noDisponible ? 'compra-item-nodisponible' : '',
    ].filter(Boolean).join(' ');
    const check = el.querySelector('.compra-check');
    if (check) check.className = `compra-check ${item.comprado?'compra-check--on':''}`;
    const noDispBtn = el.querySelector('.compra-nodisponible-btn');
    if (noDispBtn) {
      noDispBtn.textContent = item.noDisponible?'🚫':'✕';
      noDispBtn.classList.toggle('active', item.noDisponible);
    }
  }

  function _actualizarProgreso() {
    const items = _compraActual.items.filter(i=>!i.enDespensa);
    const comprados = items.filter(i=>i.comprado).length;
    const total = items.length;
    const pct = total>0 ? Math.round(comprados/total*100) : 0;
    const num = document.querySelector('.compra-progreso-num');
    const bar = document.querySelector('.compra-progreso-fill');
    if (num) num.textContent = `${comprados}/${total}`;
    if (bar) bar.style.width = `${pct}%`;
  }

  // ── Cerrar compra ────────────────────────────────────────────────

  async function _cerrarCompra() {
    const btn = document.getElementById('compra-btn-cerrar');
    if (btn) { btn.disabled=true; btn.textContent='Actualizando despensa...'; }

    const state = App.getState();
    let inventario = [...(state.inventario||[])];

    // Actualiza inventario con lo comprado
    const comprados = _compraActual.items.filter(i=>i.comprado && !i.enDespensa);
    for (const item of comprados) {
      // Busca si ya existe en el inventario (por nombre)
      const idx = inventario.findIndex(i=>i.nombre.toLowerCase()===item.nombre.toLowerCase());
      if (idx !== -1) {
        // Suma al stock existente
        inventario[idx] = {
          ...inventario[idx],
          cantidad: parseFloat((inventario[idx].cantidad + item.cantidad).toFixed(2)),
          actualizadoEn: new Date().toISOString(),
        };
      } else {
        // Crea un nuevo artículo en el inventario
        const artCatalogo = (state.catalogo||[]).find(a=>a.nombre.toLowerCase()===item.nombre.toLowerCase());
        inventario.push({
          id: `art-${Date.now()}-${Math.random().toString(36).slice(2,5)}`,
          nombre: item.nombre,
          categoria: item.seccion,
          ubicacion: 'exterior',
          cantidad: item.cantidad,
          unidad: item.unidad,
          fechaCaducidad: null,
          fechaPreferenciaUso: null,
          notificacionPreviaUso: false,
          horasNotificacionPrevia: 24,
          notas: null,
          forzarUso: false,
          paqueteMinimo: artCatalogo?.paqueteMinimo || 1,
          actualizadoEn: new Date().toISOString(),
        });
      }
    }

    await App.setState('inventario', inventario);

    // Marca la compra como completada
    _compraActual.estado = 'completada';
    _compraActual.fechaCierre = new Date().toISOString();

    // Guarda en Drive
    const fileName = `compra_${Dates.today()}.json`;
    try {
      // Guardamos en la carpeta de compras via Drive
      await Drive.writeJson(fileName, _compraActual);
    } catch { /* no crítico */ }

    // Notifica artículos no disponibles
    const noDisp = _compraActual?.items?.filter(i=>i.noDisponible) || [];

    // Limpia el estado
    App.getState().compraActual = null;
    _compraActual = null;
    _vista = 'lista';
    if (noDisp.length > 0) {
      UI.showToast(`Compra cerrada. ${noDisp.length} artículo${noDisp.length>1?'s':''} pendiente${noDisp.length>1?'s':''}`, 'warning', 5000);
    } else {
      UI.showToast('¡Compra completada! Despensa actualizada ✓', 'success', 4000);
    }

    App.navigate('inventario');
  }

  // ── Motor de generación de lista ─────────────────────────────────

  async function _generarListaCompra(menu) {
    const state = App.getState();
    const platosDB  = state.platos   || [];
    const catalogo  = state.catalogo || [];
    const inventario= state.inventario || [];

    // Acumula ingredientes necesarios por nombre
    const necesidades = {}; // nombre.toLowerCase() → { nombre, seccion, cantidad, unidad, paqueteMinimo }

    (menu.dias||[]).forEach(dia => {
      ['comida','cena'].forEach(momento => {
        const bloque = dia[momento];
        if (!bloque?.activo) return;
        const todosPlatos = [
          ...(bloque.platosMayores||[]),
          ...(bloque.platosBebe||[]),
        ];
        const idsUnicos = [...new Set(todosPlatos.map(p=>p.id))];

        idsUnicos.forEach(pid => {
          const plato = platosDB.find(p=>p.id===pid);
          if (!plato?.ingredientes?.length) return;

          plato.ingredientes.forEach(ing => {
            const key = ing.nombre.toLowerCase().trim();
            // Busca info del artículo en el catálogo
            const artCat = catalogo.find(a=>a.nombre.toLowerCase()===key);
            if (!necesidades[key]) {
              necesidades[key] = {
                nombre:          artCat?.nombre || ing.nombre,
                seccion:         artCat?.categoria || ing.categoria || 'Otros',
                cantidad:        0,
                unidad:          artCat?.unidad || ing.unidad || 'UN',
                paqueteMinimo:   artCat?.paqueteMinimo || 1,
                unidadesPorPack: artCat?.unidadesPorPack || 1,
              };
            }
            necesidades[key].cantidad += (ing.cantidad || 1);
          });
        });
      });
    });

    // Cruza con inventario: resta stock disponible y calcula packs a comprar
    const items = Object.values(necesidades).map((nec, idx) => {
      const key = nec.nombre.toLowerCase();
      const stockItems = inventario.filter(i=>i.nombre.toLowerCase()===key);
      const stockTotal = stockItems.reduce((s,i)=>s+(i.cantidad||0), 0);

      // Cantidad neta que falta (en unidades de consumo)
      const falta = Math.max(0, nec.cantidad - stockTotal);

      let packsAComprar = 0;
      let cantidadFinal = 0;

      if (falta > 0) {
        // unidadesPorPack: cuántas unidades de consumo contiene 1 pack
        const uppack = nec.unidadesPorPack || 1;
        // Cuántos packs necesito para cubrir la falta
        packsAComprar = Math.ceil(falta / uppack);
        // Redondea al paqueteMinimo (mínimo de packs que se pueden comprar juntos)
        const minPacks = nec.paqueteMinimo || 1;
        packsAComprar = Math.ceil(packsAComprar / minPacks) * minPacks;
        cantidadFinal = packsAComprar;
      }

      return {
        id:            `item-${Date.now()}-${idx}`,
        nombre:        nec.nombre,
        seccion:       nec.seccion,
        cantidad:      falta > 0 ? cantidadFinal : 0,
        cantidadNeta:  nec.cantidad,   // cuánto necesita el menú
        stockEnCasa:   stockTotal,     // cuánto hay en inventario
        unidad:        nec.unidad,
        unidadesPorPack: nec.unidadesPorPack || 1,
        paqueteMinimo: nec.paqueteMinimo,
        enDespensa:    stockTotal >= nec.cantidad,
        comprado:      false,
        noDisponible:  false,
        esExtra:       false,
      };
    });

    return {
      id:              `compra-${Date.now()}`,
      menuId:          menu.id,
      fechaCreacion:   Dates.today(),
      supermercadoId:  null,
      items,
      estado:          'pendiente',
      fechaCierre:     null,
    };
  }

  // ── Ordenar por supermercado ─────────────────────────────────────

  function _ordenarPorSuper() {
    const config = App.getState().config || {};
    const super_ = (config.supermercados||[]).find(s=>s.id===_superId);
    if (!super_) return;

    const ordenSecciones = super_.secciones.map(s=>
      typeof s === 'string' ? s : s.nombre
    );

    _compraActual.items.sort((a,b)=>{
      const ia = ordenSecciones.indexOf(a.seccion);
      const ib = ordenSecciones.indexOf(b.seccion);
      const oa = ia===-1 ? 999 : ia;
      const ob = ib===-1 ? 999 : ib;
      if (oa !== ob) return oa - ob;
      return a.nombre.localeCompare(b.nombre, 'es');
    });
  }

  // ── Buscar menú activo en Drive ───────────────────────────────────

  async function _buscarMenuActual() {
    try {
      const archivos = await Drive.listMenuFiles();
      const hoy = Dates.today();
      for (const f of archivos) {
        const m = await Drive.readMenuJson(f.id).catch(()=>null);
        if (m && m.fechaInicio<=hoy && m.fechaFin>=hoy && m.estado==='confirmado') {
          App.getState().menuActual = m;
          return m;
        }
      }
    } catch { /* */ }
    return null;
  }

  // ── Utils ────────────────────────────────────────────────────────

  function _ensureView() {
    if (!document.getElementById('view-compra')) {
      const v=document.createElement('div');
      v.id='view-compra'; v.className='view';
      document.getElementById('app-content')?.appendChild(v);
    }
  }

  return { render };

})();
