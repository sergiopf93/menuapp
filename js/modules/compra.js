/**
 * MenuApp — Módulo de Lista de la Compra y Modo Compra (Fase 4)
 *
 * Flujo:
 *   1. El usuario añade artículos y, si quiere, los genera desde el menú activo
 *   2. El usuario revisa y ajusta
 *   3. Selecciona supermercado → la lista se ordena por secciones
 *   4. Modo compra: marca artículos uno a uno
 *   5. Cierra la compra → elimina solo los artículos marcados como comprados
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

  // ── Persistencia offline ─────────────────────────────────────────
  // Guarda la lista en localStorage (inmediato, funciona offline)
  // y encola la subida a Drive cuando haya conexión
  

  const _norm = str => Sync.normalize ? Sync.normalize(str) : (str||'').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ñ/g,'n').trim();

  const COMPRA_LOCAL_KEY = 'menuapp_compra_actual';

  function _listaVacia() {
    return { id: 'lista-compra', fechaCreacion: null, supermercadoId: null, items: [], removidos: {}, estado: 'pendiente', fechaCierre: null };
  }

  function _guardarLocal(compra) {
    try {
      localStorage.setItem(COMPRA_LOCAL_KEY, JSON.stringify(compra));
    } catch(e) {
      console.warn('[Compra] Error guardando en local:', e);
    }
  }

  function _cargarLocal() {
    try {
      const raw = localStorage.getItem(COMPRA_LOCAL_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  let _superId = null;         // supermercado seleccionado

  // ── API pública ──────────────────────────────────────────────────

  function render() {
    _ensureView();
    const view = document.getElementById('view-compra');
    if (!view) return;

    const state = App.getState();
    // La copia local tiene prioridad; la vista incorpora después lo que haya en Drive.
    _compraActual = _cargarLocal() || state.compraActual || _listaVacia();
    state.compraActual = _compraActual;
    // La vista de lista fusiona primero el estado remoto antes de iniciar compra.
    _vista = 'lista';

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
    const menuActual = await _buscarMenuActual();
    state.menuActual = menuActual;
    if (!_compraActual) _compraActual = _listaVacia();

    // La lista remota se incorpora a la local al abrir; guardar en Drive sigue siendo explícito.
    try {
      const driveLista = await Sync.readCompra();
      _compraActual = Sync.mergeCompras(driveLista, _compraActual);
    } catch (e) {
      console.warn('[Compra] No se pudo consultar la lista de Drive:', e.message);
    }
    state.compraActual = _compraActual;
    // Los datos antiguos pueden traer enDespensa=true. Despensa está desactivada,
    // así que esos artículos siguen perteneciendo a la lista de compra.
    _compraActual.items = (_compraActual.items || []).map(item => ({ ...item, enDespensa: false }));
    _compraActual.estado = 'pendiente';
    _guardarLocal(_compraActual);

    const items = _compraActual.items || [];
    const aComprar  = items.filter(i => !i.comprado);

    view.innerHTML = `
      <div class="module-header">
        <h1 class="module-title">Lista de la compra</h1>
      </div>

      <p class="text-sm text-muted" style="margin-bottom:var(--space-4)">
        ${menuActual ? `Menú activo en Drive: ${Dates.format(menuActual.fechaInicio,'numeric')} al ${Dates.format(menuActual.fechaFin,'numeric')}.` : 'No hay un menú activo en Drive. Puedes mantener y guardar una lista manual.'}
        La lista no está ligada a una semana.
      </p>

      <!-- Paneles consulta rápida -->
      ${menuActual ? '<div class="compra-paneles-consulta"><button class="btn btn-secondary btn-sm" id="compra-panel-menu-btn">📅 Ver menú activo</button></div>' : ''}
      <div id="compra-panel-menu" class="menu-info-panel hidden"></div>

      <!-- Resumen -->
      <div class="inv-summary-bar" style="margin-bottom:var(--space-4)">
        <span class="badge badge-blue">${aComprar.length} a comprar</span>
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
          <p>${items.length ? '✓ No hay artículos pendientes de compra.' : 'La lista está vacía. Añade artículos o genera la lista desde el menú activo.'}</p>
        </div>`}

      <!-- Añadir artículo extra -->
      <div class="dashboard-section">
        <h2 class="section-title">Añadir artículo extra</h2>
        <div class="compra-add-extra" style="position:relative">
          <div style="flex:1;position:relative">
            <input class="form-control" id="compra-extra-input" type="text"
                   placeholder="Escribe para buscar en el catálogo..." autocomplete="off"
                   style="width:100%"/>
            <div id="compra-extra-suggestions" class="pl-ing-suggestions hidden"
                 style="position:absolute;left:0;right:0;top:100%;z-index:100"></div>
          </div>
          <button class="btn btn-secondary" id="compra-btn-extra">Añadir</button>
        </div>
      </div>

      <!-- Botón ir a comprar -->
      <div style="margin-top:var(--space-6)">
        <div style="display:flex;gap:var(--space-3);margin-bottom:var(--space-3)">
          <button class="btn btn-secondary" id="compra-btn-guardar" style="flex:1">
            💾 Guardar lista
          </button>
          <button class="btn btn-primary" style="flex:1" id="compra-btn-generar-nuevo" ${menuActual ? '' : 'disabled'}>
            🔄 Generar del menú
          </button>
        </div>
        <button class="btn btn-primary btn-full" id="compra-btn-ir" ${items.length===0?'disabled':''}>
          🛒 Ir a comprar →
        </button>
      </div>
    `;

    _bindListaEvents();
  }

  function _buildItemRevision(item) {
    return `
      <div class="compra-item-rev" data-id="${item.id}">
        <div class="compra-item-info">
          <span class="compra-item-nombre">${UI.escapeHtml(item.nombre)}</span>
          <span class="compra-item-meta">${item.cantidad} ${item.unidad} · ${UI.escapeHtml(item.seccion)}</span>
        </div>
        <div class="compra-item-actions">
          <button class="inv-qty-btn compra-qty-minus" data-id="${item.id}">−</button>
          <div class="inv-qty-display" style="min-width:40px">
            <span class="inv-qty-value compra-qty-val" data-id="${item.id}">${item.cantidad}</span>
            <span class="inv-qty-unit">${item.unidad}</span>
          </div>
          <button class="inv-qty-btn inv-qty-plus compra-qty-plus" data-id="${item.id}">+</button>
          <button class="inv-action-btn inv-action-delete compra-item-rm" data-id="${item.id}" style="margin-left:var(--space-1)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
          </button>
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

    // Guardar lista manualmente
    document.getElementById('compra-btn-guardar')?.addEventListener('click', async () => {
      if (!_compraActual) return;
      _guardarLocal(_compraActual);
      try {
        _compraActual = await Sync.saveCompra(_compraActual);
        App.getState().compraActual = _compraActual;
        _guardarLocal(_compraActual);
        const pendiente = Sync.isPending('lista_compra.json');
        UI.showToast(pendiente ? 'Guardado en local; se sincronizará al recuperar conexión' : 'Lista combinada y guardada en Drive ✓', 'success');
        _renderVista();
      } catch (e) {
        UI.showToast('La lista sigue guardada en este dispositivo; no se pudo guardar en Drive', 'warning');
      }
    });

    // Generar del último menú
    document.getElementById('compra-btn-generar-nuevo')?.addEventListener('click', async () => {
      const menuActual = await _buscarMenuActual();
      if (!menuActual) { UI.showToast('No hay menú generado', 'error'); return; }
      const ok = await UI.confirm('¿Añadir a la lista los artículos necesarios para el menú activo? Los artículos actuales se conservarán.', 'Generar');
      if (!ok) return;
      await _anadirMenuALaLista(menuActual);
      _renderVista();
      UI.showToast('Artículos del menú añadidos a la lista', 'success');
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
        _compraActual.removidos = _compraActual.removidos || {};
        _compraActual.removidos[_norm(item.nombre)] = new Date().toISOString();
        _compraActual.items = _compraActual.items.filter(i=>i.id!==id);
        e.target.closest('.compra-item-rev')?.remove();
        App.getState().compraActual = _compraActual;
      }
      if (!e.target.closest('.compra-item-rm')) item.actualizadoEn = new Date().toISOString();
      _guardarLocal(_compraActual);
    });

    // Artículo extra — con autocomplete del catálogo
    const extraInput = document.getElementById('compra-extra-input');
    const suggBox    = document.getElementById('compra-extra-suggestions');
    const catalogo   = App.getState().catalogo || [];

    // Estado del artículo seleccionado (puede ser del catálogo o libre)
    let _extraSeleccionado = null;

    function _addExtra() {
      const nombre = extraInput?.value.trim();
      if (!nombre) return;

      const art = _extraSeleccionado && _norm(_extraSeleccionado.nombre) === _norm(nombre)
        ? _extraSeleccionado
        : catalogo.find(a => _norm(a.nombre) === _norm(nombre));
      if (!art) {
        _crearArticuloDesdeCompra(nombre);
        return;
      }

      const nuevo = {
        id:           `extra-${Date.now()}`,
        nombre:       art?.nombre || nombre,
        cantidad:     art?.paqueteMinimo || 1,
        unidad:       art?.unidad || 'UN',
        seccion:      art?.categoria || 'Otros',
        paqueteMinimo:art?.paqueteMinimo || 1,
        unidadesPorPack: art?.unidadesPorPack || 1,
        enDespensa:   false,
        comprado:     false,
        noDisponible: false,
        esExtra:      true,
        actualizadoEn: new Date().toISOString(),
      };

      _compraActual.removidos = _compraActual.removidos || {};
      delete _compraActual.removidos[_norm(nuevo.nombre)];
      _compraActual = Sync.mergeCompras(_compraActual, { items: [nuevo], removidos: {} });
      App.getState().compraActual = _compraActual;
      _guardarLocal(_compraActual);
      extraInput.value = '';
      _extraSeleccionado = null;
      if(suggBox) suggBox.classList.add('hidden');
      _renderVista();
      UI.showToast(`${nuevo.nombre} añadido`, 'success');
    }

    document.getElementById('compra-btn-extra')?.addEventListener('click', _addExtra);

    extraInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { _addExtra(); return; }
      if (e.key === 'Escape') { suggBox?.classList.add('hidden'); return; }
      // Navegar sugerencias con flechas
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const items = suggBox?.querySelectorAll('.compra-sugg-item');
        if (!items?.length) return;
        const active = suggBox.querySelector('.compra-sugg-item.active');
        let idx = active ? [...items].indexOf(active) : -1;
        active?.classList.remove('active');
        idx = e.key === 'ArrowDown'
          ? Math.min(idx + 1, items.length - 1)
          : Math.max(idx - 1, 0);
        items[idx].classList.add('active');
        e.preventDefault();
      }
    });

    let _suggTimer;
    extraInput?.addEventListener('input', () => {
      clearTimeout(_suggTimer);
      const val = extraInput.value.trim().toLowerCase();
      if (!val || val.length < 1) { suggBox?.classList.add('hidden'); return; }

      _suggTimer = setTimeout(() => {
        const matches = catalogo
          .filter(a => a.activo !== false && _norm(a.nombre).includes(_norm(val)))
          .sort((a, b) => {
            // Primero los que empiezan por el texto buscado
            const aStarts = _norm(a.nombre).startsWith(_norm(val));
            const bStarts = b.nombre.toLowerCase().startsWith(val);
            if (aStarts && !bStarts) return -1;
            if (!aStarts && bStarts) return 1;
            return a.nombre.localeCompare(b.nombre, 'es');
          })
          .slice(0, 8);

        if (!matches.length) {
          // No existe en el catálogo — ofrece crear el artículo
          suggBox.innerHTML = `
            <div class="compra-sugg-crear" data-nombre="${UI.escapeHtml(extraInput.value.trim())}">
              <span>➕ Crear "<strong>${UI.escapeHtml(extraInput.value.trim())}</strong>" en el catálogo y añadir</span>
            </div>`;
          suggBox.classList.remove('hidden');
          suggBox.querySelector('.compra-sugg-crear')?.addEventListener('mousedown', async (e) => {
            e.preventDefault();
            const nombre = extraInput.value.trim();
            if (!nombre) return;
            // Abre mini-formulario para completar los datos del artículo
            await _crearArticuloDesdeCompra(nombre);
            suggBox.classList.add('hidden');
          });
          return;
        }

        suggBox.innerHTML = matches.map(a => `
          <div class="compra-sugg-item" data-nombre="${UI.escapeHtml(a.nombre)}" data-id="${a.id}">
            <span class="compra-sugg-nombre">${UI.escapeHtml(a.nombre)}</span>
            <span class="compra-sugg-meta">${UI.escapeHtml(a.categoria||'')} · ${a.unidad}</span>
          </div>`).join('');
        suggBox.classList.remove('hidden');

        // Bind clicks en sugerencias
        suggBox.querySelectorAll('.compra-sugg-item').forEach(item => {
          item.addEventListener('mousedown', (e) => {
            e.preventDefault(); // evita blur del input
            const art = catalogo.find(a => a.id === item.dataset.id);
            _extraSeleccionado = art || null;
            extraInput.value = item.dataset.nombre;
            suggBox.classList.add('hidden');
            _addExtra();
          });
        });
      }, 150);
    });

    // Cierra sugerencias al perder foco
    extraInput?.addEventListener('blur', () => {
      setTimeout(() => suggBox?.classList.add('hidden'), 200);
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
        _guardarLocal(_compraActual);
        _vista = 'modo-compra';
        _renderVista();
      });
    });
  }

  // ── Vista 3: Modo compra ─────────────────────────────────────────

  function _renderModoCompra(view) {
    const items = _compraActual.items;
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
          ✓ Cerrar compra
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
        item.actualizadoEn = new Date().toISOString();
        _actualizarItemUI(item);
        _actualizarProgreso();
        App.getState().compraActual = _compraActual;
        _guardarLocal(_compraActual);
      } else if (e.target.closest('.compra-nodisponible-btn')) {
        item.noDisponible = !item.noDisponible;
        item.comprado = false;
        item.actualizadoEn = new Date().toISOString();
        _actualizarItemUI(item);
        App.getState().compraActual = _compraActual;
        _guardarLocal(_compraActual);
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
    const items = _compraActual.items;
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
    if (btn) { btn.disabled=true; btn.textContent='Cerrando compra...'; }
    const comprados = _compraActual.items.filter(i=>i.comprado);
    _compraActual.removidos = _compraActual.removidos || {};
    comprados.forEach(item => { _compraActual.removidos[_norm(item.nombre)] = new Date().toISOString(); });
    _compraActual.items = _compraActual.items.filter(i=>!i.comprado);
    _compraActual.estado = 'pendiente';
    _compraActual.supermercadoId = null;
    App.getState().compraActual = _compraActual;
    _guardarLocal(_compraActual);
    _vista = 'lista';
    let guardadoEnDrive = false;
    try {
      _compraActual = await Sync.saveCompra(_compraActual);
      guardadoEnDrive = !Sync.isPending('lista_compra.json');
      App.getState().compraActual = _compraActual;
      _guardarLocal(_compraActual);
    } catch (e) {
      console.warn('[Compra] No se pudo guardar el cierre en Drive:', e.message);
    }
    UI.showToast(
      guardadoEnDrive
        ? `${comprados.length} artículo${comprados.length===1?' eliminado':'s eliminados'}; lista actualizada en Drive.`
        : `Compra cerrada en este dispositivo; el guardado en Drive queda pendiente.`,
      guardadoEnDrive ? 'success' : 'warning',
      5000
    );
    _renderVista();
  }

  // ── Motor de generación de lista ─────────────────────────────────

  async function _generarListaCompra(menu) {
    const state = App.getState();
    const platosDB  = state.platos   || [];
    const catalogo  = state.catalogo || [];

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
            const key = _norm(ing.nombre);
            // Busca info del artículo en el catálogo
            const artCat = catalogo.find(a=>_norm(a.nombre)===key);
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

    // Calcula cantidades desde los ingredientes; la despensa no participa en la lista.
    const items = Object.values(necesidades).map((nec, idx) => {
      const unidadesPorPack = nec.unidadesPorPack || 1;
      let cantidadFinal = Math.ceil(nec.cantidad / unidadesPorPack);
      const minPacks = nec.paqueteMinimo || 1;
      cantidadFinal = Math.max(minPacks, Math.ceil(cantidadFinal / minPacks) * minPacks);

      return {
        id:            `item-${Date.now()}-${idx}`,
        nombre:        nec.nombre,
        seccion:       nec.seccion,
        cantidad:      cantidadFinal,
        cantidadNeta:  nec.cantidad,   // cuánto necesita el menú
        unidad:        nec.unidad,
        unidadesPorPack: nec.unidadesPorPack || 1,
        paqueteMinimo: nec.paqueteMinimo,
        enDespensa:    false,
        comprado:      false,
        noDisponible:  false,
        esExtra:       false,
        actualizadoEn: new Date().toISOString(),
      };
    });

    return {
      id:              `compra-${Date.now()}`,
      menuId:          menu.id,
      fechaCreacion:   null,
      supermercadoId:  null,
      items,
      estado:          'pendiente',
      fechaCierre:     null,
    };
  }

  async function _anadirMenuALaLista(menu) {
    const generada = await _generarListaCompra(menu);
    _compraActual = _compraActual || _listaVacia();
    _compraActual.removidos = _compraActual.removidos || {};
    generada.items.forEach(item => { delete _compraActual.removidos[_norm(item.nombre)]; });
    _compraActual = Sync.mergeCompras(_compraActual, generada);
    _compraActual.menuId = menu.id;
    _compraActual.menuActualizadoEn = menu.actualizadoEn || menu.confirmadoEn || null;
    App.getState().compraActual = _compraActual;
    _guardarLocal(_compraActual);
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
      if (!Drive.getFolderIds().menusFolderId) await Drive.initFolderStructure();
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

  /**
   * Mini-formulario para crear un artículo del catálogo directamente desde la lista de compra.
   * Crea el artículo en el catálogo y lo añade a la lista en un solo paso.
   */
  async function _crearArticuloDesdeCompra(nombre) {
    const CATEGORIAS = [
      'Frutas y verduras','Carnicería','Pescadería','Lácteos','Conservas',
      'Legumbres','Pasta, arroz y cereales','Especias','Aceites y vinagres',
      'Salsas y condimentos','Charcutería y envasados','Pan y bollería',
      'Repostería y panadería','Congelados','Bebidas','Limpieza',
      'Droguería y perfumería','Snacks y frutos secos','Dulces y chocolates',
      'Café e infusiones','Preparados y semiconservas','Otros',
    ];

    const container = document.createElement('div');
    container.innerHTML = `
      <p class="text-sm text-muted" style="margin-bottom:var(--space-4)">
        "<strong>${UI.escapeHtml(nombre)}</strong>" no existe en el catálogo. 
        Completa los datos para crearlo y añadirlo a la lista.
      </p>
      <div class="form-group">
        <label class="form-label">Categoría (sección del super) *</label>
        <select class="form-control" id="cac-categoria">
          ${CATEGORIAS.map(c=>`<option>${UI.escapeHtml(c)}</option>`).join('')}
        </select>
      </div>
      <div style="display:flex;gap:var(--space-3)">
        <div class="form-group" style="flex:1">
          <label class="form-label">Unidad</label>
          <select class="form-control" id="cac-unidad">
            ${['UN','KG','GR','L','ML','PAQ'].map(u=>`<option>${u}</option>`).join('')}
          </select>
        </div>
        <div class="form-group" style="flex:1">
          <label class="form-label">Cantidad habitual</label>
          <input class="form-control" id="cac-cantidad" type="number" min="1" value="1"/>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Notas (opcional)</label>
        <input class="form-control" id="cac-notas" type="text" placeholder="Marca, formato..."/>
      </div>`;

    let modalRef = UI.showModal({
      title: `Crear artículo — ${nombre}`,
      content: container,
      buttons: [
        { label: 'Cancelar', type: 'secondary' },
        { label: '✓ Crear y añadir a la lista', type: 'primary', onClick: async () => {
          const categoria = document.getElementById('cac-categoria')?.value;
          const unidad    = document.getElementById('cac-unidad')?.value || 'UN';
          const cantidad  = parseInt(document.getElementById('cac-cantidad')?.value) || 1;
          const notas     = document.getElementById('cac-notas')?.value.trim() || null;

          // Crea en el catálogo
          const state   = App.getState();
          const catalogo= [...(state.catalogo||[])];
          const ahora   = new Date().toISOString();
          const nuevoArt = {
            id: `cat-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
            nombre, categoria, unidad,
            paqueteMinimo: cantidad,
            unidadesPorPack: cantidad,
            notas, activo: true, actualizadoEn: ahora,
          };
          catalogo.push(nuevoArt);
          await App.setState('catalogo', catalogo);

          // Añade a la lista de compra
          if (_compraActual) {
            _compraActual.removidos = _compraActual.removidos || {};
            delete _compraActual.removidos[_norm(nombre)];
            const item = {
              id: `extra-${Date.now()}`,
              nombre, cantidad, unidad,
              seccion: categoria,
              paqueteMinimo: cantidad,
              unidadesPorPack: cantidad,
              enDespensa: false, comprado: false, noDisponible: false, esExtra: true,
              actualizadoEn: new Date().toISOString(),
            };
            _compraActual = Sync.mergeCompras(_compraActual, { items: [item], removidos: {} });
            App.getState().compraActual = _compraActual;
            _guardarLocal(_compraActual);
          }

          UI.showToast(`${nombre} creado en el catálogo y añadido a la lista`, 'success');
          if (modalRef) modalRef.close();

          // Limpia el input de búsqueda
          const extraInput = document.getElementById('compra-extra-input');
          if (extraInput) extraInput.value = '';
          _renderVista();
        }},
      ],
    });
  }

  return { render };

})();
