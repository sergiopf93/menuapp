/**
 * MenuApp — Módulo de Catálogo de Platos (Fase 2 — completo)
 *
 * Funcionalidades:
 * - Listado con filtros por tipo de menú, tipo de plato, tipo de comida
 * - Búsqueda por nombre y etiquetas
 * - Alta, edición y baja de platos
 * - Asignación de ingredientes del inventario con cantidades
 * - Configuración de notificación previa (texto + horas)
 * - Configuración de frecuencia mínima entre repeticiones
 * - Activar/desactivar plato
 *
 * @module Platos
 */

const Platos = (() => {

  // ── Estado local ─────────────────────────────────────────────────
  let _filtroTexto  = '';
  let _filtroTipoMenu  = 'todos';
  let _filtroTipoPlato = 'todos';
  let _filtroComida    = 'todos';

  // ── Constantes ───────────────────────────────────────────────────
  const TIPO_MENU  = { todos:'Todos', mayores:'Adultos', bebe:'Bebé' };
  const TIPO_PLATO = { todos:'Todos', unico:'Plato único', primero:'Primero', segundo:'Segundo' };
  const TIPO_COMIDA= { todos:'Todos', comida:'Comida', cena:'Cena', ambos:'Ambos' };

  const ETIQUETAS_SUGERIDAS = [
    'legumbre','pescado','carne','pasta','arroz','verdura','huevo',
    'sopa','ensalada','guiso','invierno','verano','rápido','bebé',
  ];

  // ── API pública ──────────────────────────────────────────────────

  function render() {
    _ensureView();
    const view = document.getElementById('view-platos');
    if (!view) return;
    view.innerHTML = _buildShell();
    _bindShellEvents();
    _renderList();
  }

  // ── Shell ────────────────────────────────────────────────────────

  function _buildShell() {
    return `
      <div class="module-header">
        <h1 class="module-title">Platos</h1>
        <button class="btn btn-primary btn-sm" id="pl-btn-add">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="16" height="16">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          Añadir
        </button>
      </div>

      <!-- Búsqueda -->
      <div class="search-bar" style="margin-bottom:var(--space-3)">
        <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
        </svg>
        <input type="search" id="pl-search" placeholder="Buscar plato..."
               value="${UI.escapeHtml(_filtroTexto)}" autocomplete="off"/>
      </div>

      <!-- Filtros -->
      <div class="pl-filtros">
        <div class="pl-filtro-group">
          <span class="pl-filtro-label">Para:</span>
          <div class="pl-chips" id="pl-chips-menu">
            ${Object.entries(TIPO_MENU).map(([k,v]) =>
              `<button class="pl-chip ${_filtroTipoMenu===k?'active':''}" data-group="menu" data-val="${k}">${v}</button>`
            ).join('')}
          </div>
        </div>
        <div class="pl-filtro-group">
          <span class="pl-filtro-label">Tipo:</span>
          <div class="pl-chips" id="pl-chips-plato">
            ${Object.entries(TIPO_PLATO).map(([k,v]) =>
              `<button class="pl-chip ${_filtroTipoPlato===k?'active':''}" data-group="plato" data-val="${k}">${v}</button>`
            ).join('')}
          </div>
        </div>
        <div class="pl-filtro-group">
          <span class="pl-filtro-label">Momento:</span>
          <div class="pl-chips" id="pl-chips-comida">
            ${Object.entries(TIPO_COMIDA).map(([k,v]) =>
              `<button class="pl-chip ${_filtroComida===k?'active':''}" data-group="comida" data-val="${k}">${v}</button>`
            ).join('')}
          </div>
        </div>
      </div>

      <!-- Resumen -->
      <div id="pl-summary" class="pl-summary"></div>

      <!-- Lista -->
      <div id="pl-list"></div>
    `;
  }

  function _bindShellEvents() {
    document.getElementById('pl-btn-add')?.addEventListener('click', () => openForm());

    let searchTimer;
    document.getElementById('pl-search')?.addEventListener('input', (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        _filtroTexto = e.target.value.trim().toLowerCase();
        _renderList();
      }, 250);
    });

    document.querySelector('.pl-filtros')?.addEventListener('click', (e) => {
      const chip = e.target.closest('.pl-chip');
      if (!chip) return;
      const { group, val } = chip.dataset;
      if (group === 'menu')   _filtroTipoMenu  = val;
      if (group === 'plato')  _filtroTipoPlato = val;
      if (group === 'comida') _filtroComida    = val;
      document.querySelectorAll(`.pl-chip[data-group="${group}"]`).forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      _renderList();
    });
  }

  // ── Lista ────────────────────────────────────────────────────────

  function _renderList() {
    const container = document.getElementById('pl-list');
    const summary   = document.getElementById('pl-summary');
    if (!container) return;

    const { platos } = App.getState();
    const items = platos || [];

    const filtered = items.filter(p => {
      const matchMenu  = _filtroTipoMenu  === 'todos' || p.tipoMenu?.includes(_filtroTipoMenu);
      const matchPlato = _filtroTipoPlato === 'todos' || p.tipoPlato === _filtroTipoPlato;
      const matchComida= _filtroComida    === 'todos' ||
        p.tipoComida?.includes(_filtroComida) || p.tipoComida?.includes('ambos');
      const matchText  = !_filtroTexto ||
        p.nombre.toLowerCase().includes(_filtroTexto) ||
        (p.etiquetas||[]).some(e => e.toLowerCase().includes(_filtroTexto));
      return matchMenu && matchPlato && matchComida && matchText;
    });

    // Resumen
    if (summary) {
      const activos   = items.filter(p => p.activo !== false).length;
      const inactivos = items.filter(p => p.activo === false).length;
      summary.innerHTML = items.length > 0 ? `
        <div class="pl-summary-bar">
          <span class="badge badge-green">${activos} activo${activos!==1?'s':''}</span>
          ${inactivos>0?`<span class="badge badge-gray">${inactivos} inactivo${inactivos!==1?'s':''}</span>`:''}
          <span class="text-muted text-xs" style="margin-left:auto">${filtered.length} mostrado${filtered.length!==1?'s':''}</span>
        </div>` : '';
    }

    if (filtered.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">🍽️</div>
          <h2 class="empty-state-title">${_filtroTexto||_filtroTipoMenu!=='todos'||_filtroTipoPlato!=='todos'?'Sin resultados':'Sin platos'}</h2>
          <p class="empty-state-desc">
            ${items.length === 0
              ? 'Añade tus platos habituales para que el generador pueda crear menús.'
              : 'Ningún plato coincide con los filtros seleccionados.'}
          </p>
          ${items.length === 0 ? `<button class="btn btn-primary" id="pl-empty-add">Añadir primer plato</button>` : ''}
        </div>`;
      document.getElementById('pl-empty-add')?.addEventListener('click', () => openForm());
      return;
    }

    container.innerHTML = filtered
      .sort((a,b) => a.nombre.localeCompare(b.nombre,'es'))
      .map(_buildCard).join('');

    _bindCardEvents(container);
  }

  function _buildCard(plato) {
    const inactivo = plato.activo === false;
    const tipoMenuLabel = (plato.tipoMenu||[]).map(t => ({
      mayores:'👨 Adultos', bebe:'👶 Bebé', todos:'👨👶 Todos'
    }[t]||t)).join(', ');

    const tipoComidaLabel = (plato.tipoComida||[]).map(t => ({
      comida:'🍽 Comida', cena:'🌙 Cena', ambos:'🍽🌙 Ambos'
    }[t]||t)).join(', ');

    const tipoPlatoLabel = {
      unico:'Plato único', primero:'Primero', segundo:'Segundo'
    }[plato.tipoPlato] || plato.tipoPlato;

    const numIngredientes = (plato.ingredientes||[]).length;
    const tieneNotif = !!plato.notificacionPrevia;

    return `
      <div class="pl-card ${inactivo?'pl-card--inactivo':''}" data-id="${plato.id}">
        <div class="pl-card-header">
          <div class="pl-card-titulo">
            <span class="pl-card-nombre">${UI.escapeHtml(plato.nombre)}</span>
            ${inactivo?'<span class="badge badge-gray">Inactivo</span>':''}
          </div>
          <button class="pl-toggle-btn" data-id="${plato.id}"
                  title="${inactivo?'Activar plato':'Desactivar plato'}">
            <div class="pl-toggle ${inactivo?'':'pl-toggle--on'}"></div>
          </button>
        </div>

        <div class="pl-card-badges">
          <span class="badge badge-blue">${tipoPlatoLabel}</span>
          <span class="badge badge-gray">${tipoMenuLabel}</span>
          <span class="badge badge-gray">${tipoComidaLabel}</span>
          ${plato.frecuenciaMinSemanas?`<span class="badge badge-gray">↻ cada ${plato.frecuenciaMinSemanas}sem</span>`:''}
          ${plato.permiteRepeticion?`<span class="badge badge-green">↻ repite</span>`:''}        </div>

        ${(plato.etiquetas||[]).length>0?`
          <div class="pl-card-etiquetas">
            ${[...new Set(plato.etiquetas||[])].map(e=>`<span class="pl-etiqueta">${UI.escapeHtml(e)}</span>`).join('')}
          </div>`:''}

        <div class="pl-card-meta">
          ${numIngredientes>0?`<span class="pl-meta-item">🥕 ${numIngredientes} ingrediente${numIngredientes!==1?'s':''}</span>`:''}
          ${tieneNotif?`<span class="pl-meta-item">🔔 ${plato.horasNotificacionPrevia||24}h antes</span>`:''}
          ${plato.notificacionPrevia?`<span class="pl-meta-notif">"${UI.escapeHtml(plato.notificacionPrevia)}"</span>`:''}
        </div>

        <div class="inv-card-actions">
          <button class="inv-action-btn pl-action-edit" data-id="${plato.id}" title="Editar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            Editar
          </button>
          <button class="inv-action-btn inv-action-delete" data-id="${plato.id}" title="Eliminar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
            Eliminar
          </button>
        </div>
      </div>`;
  }

  function _bindCardEvents(container) {
    container.addEventListener('click', async (e) => {
      const id = e.target.closest('[data-id]')?.dataset.id;
      if (!id) return;
      if      (e.target.closest('.pl-action-edit'))   openForm(id);
      else if (e.target.closest('.inv-action-delete')) await _deletePlato(id);
      else if (e.target.closest('.pl-toggle-btn'))     await _toggleActivo(id);
    });
  }

  // ── Toggle activo ────────────────────────────────────────────────

  async function _toggleActivo(id) {
    const state = App.getState();
    const platos = [...(state.platos||[])];
    const idx = platos.findIndex(p => p.id===id);
    if (idx===-1) return;
    platos[idx] = {...platos[idx], activo: platos[idx].activo===false ? true : false,
                   actualizadoEn: new Date().toISOString()};
    await App.setState('platos', platos);
    UI.showToast(platos[idx].activo!==false?`${platos[idx].nombre} activado`:`${platos[idx].nombre} desactivado`,'info');
    _renderList();
  }

  // ── Eliminar ─────────────────────────────────────────────────────

  async function _deletePlato(id) {
    const state = App.getState();
    const plato = (state.platos||[]).find(p => p.id===id);
    if (!plato) return;
    const ok = await UI.confirm(`¿Eliminar <strong>${UI.escapeHtml(plato.nombre)}</strong> del catálogo?`,'Eliminar');
    if (!ok) return;
    const platos = (state.platos||[]).filter(p => p.id!==id);
    await App.setState('platos', platos);
    UI.showToast(`${plato.nombre} eliminado`,'success');
    _renderList();
  }

  // ── Formulario ───────────────────────────────────────────────────

  function openForm(id=null) {
    const state = App.getState();
    const plato = id?(state.platos||[]).find(p=>p.id===id):null;
    const catalogo = Articulos.getCatalogo(); // ← usa el catálogo, no el inventario
    const container = document.createElement('div');
    container.innerHTML = _buildForm(plato, catalogo);
    UI.showModal({
      title: plato?`Editar — ${plato.nombre}`:'Añadir plato',
      content: container,
      buttons:[
        {label:'Cancelar',type:'secondary'},
        {label:plato?'Guardar cambios':'Añadir plato',type:'primary',onClick:()=>_submitForm(plato)},
      ],
    });
    setTimeout(()=>_initFormEvents(catalogo),100);
  }

  function _buildForm(plato, inventario) {
    const tieneNotif = !!plato?.notificacionPrevia;
    const ingredientes = plato?.ingredientes||[];

    // Opciones de tipoMenu (multi-select visual)
    const tiposMenu = ['mayores','bebe','todos'];
    const tiposPlato = ['unico','primero','segundo'];
    const tiposComida = ['comida','cena','ambos'];

    return `
      <!-- Nombre -->
      <div class="form-group">
        <label class="form-label" for="pl-f-nombre">Nombre del plato <span class="required">*</span></label>
        <input class="form-control" id="pl-f-nombre" type="text"
               value="${UI.escapeHtml(plato?.nombre||'')}" placeholder="Ej: Cocido madrileño, Merluza al horno..." autocomplete="off"/>
      </div>

      <!-- Tipo menú -->
      <div class="form-group">
        <label class="form-label">Para quién <span class="required">*</span></label>
        <div class="pl-chips pl-chips--form">
          ${tiposMenu.map(t=>`
            <button type="button" class="pl-chip pl-chip-tipomenu ${(plato?.tipoMenu||['todos']).includes(t)?'active':''}" data-val="${t}">
              ${{mayores:'👨 Adultos',bebe:'👶 Bebé',todos:'👨👶 Todos'}[t]}
            </button>`).join('')}
        </div>
        <p class="form-hint">Puedes seleccionar varios. "Todos" incluye adultos y bebés.</p>
      </div>

      <!-- Tipo plato -->
      <div class="form-group">
        <label class="form-label">Tipo de plato <span class="required">*</span></label>
        <div class="pl-chips pl-chips--form">
          ${tiposPlato.map(t=>`
            <button type="button" class="pl-chip pl-chip-tipoplato ${(plato?.tipoPlato||'unico')===t?'active':''}" data-val="${t}">
              ${{unico:'🍽 Único',primero:'1️⃣ Primero',segundo:'2️⃣ Segundo'}[t]}
            </button>`).join('')}
        </div>
      </div>

      <!-- Tipo comida -->
      <div class="form-group">
        <label class="form-label">Momento <span class="required">*</span></label>
        <div class="pl-chips pl-chips--form">
          ${tiposComida.map(t=>`
            <button type="button" class="pl-chip pl-chip-tipocomida ${(plato?.tipoComida||['ambos']).includes(t)?'active':''}" data-val="${t}">
              ${{comida:'🍽 Comida',cena:'🌙 Cena',ambos:'🍽🌙 Ambos'}[t]}
            </button>`).join('')}
        </div>
      </div>

      <!-- Repetición en semana -->
      <div class="form-group">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
          <input type="checkbox" id="pl-f-repetir" ${plato?.permiteRepeticion?'checked':''}/>
          <span class="form-label" style="margin:0">Puede repetirse en la misma semana</span>
        </label>
        <p class="form-hint">Actívalo para guarniciones y verduras habituales (ensalada, brócoli, judías verdes...).</p>
      </div>

      <!-- Frecuencia -->
      <div class="form-group">
        <label class="form-label" for="pl-f-freq">Semanas mínimas entre repeticiones</label>
        <input class="form-control" id="pl-f-freq" type="number" min="1" max="12"
               value="${plato?.frecuenciaMinSemanas||2}" placeholder="2"/>
        <p class="form-hint">El generador no repetirá este plato antes de N semanas.</p>
      </div>

      <!-- Notificación previa -->
      <div class="form-group">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
          <input type="checkbox" id="pl-f-notif-cb" ${tieneNotif?'checked':''}/>
          <span class="form-label" style="margin:0">Requiere preparación previa</span>
        </label>
        <p class="form-hint">Ej: garbanzos en remojo, masa de pan, sacar del congelador...</p>
      </div>

      <div id="pl-f-notif-block" style="${tieneNotif?'':'display:none'}">
        <div class="form-group">
          <label class="form-label" for="pl-f-notif-texto">Mensaje de notificación</label>
          <input class="form-control" id="pl-f-notif-texto" type="text"
                 value="${UI.escapeHtml(plato?.notificacionPrevia||'')}"
                 placeholder="Ej: Poner garbanzos en remojo esta noche"/>
        </div>
        <div class="form-group">
          <label class="form-label" for="pl-f-notif-horas">Horas de antelación</label>
          <input class="form-control" id="pl-f-notif-horas" type="number"
                 min="1" max="72" value="${plato?.horasNotificacionPrevia||16}"/>
        </div>
      </div>

      <!-- Etiquetas -->
      <div class="form-group">
        <label class="form-label">Etiquetas</label>
        <div class="pl-etiquetas-editor">
          <div id="pl-f-etiquetas-selected" class="pl-etiquetas-selected">
            ${(plato?.etiquetas||[]).map(e=>`
              <span class="pl-etiqueta pl-etiqueta--editable" data-e="${UI.escapeHtml(e)}">
                ${UI.escapeHtml(e)} <button class="pl-etiqueta-rm" data-e="${UI.escapeHtml(e)}">×</button>
              </span>`).join('')}
          </div>
          <div class="pl-etiquetas-sugeridas">
            ${ETIQUETAS_SUGERIDAS.map(e=>`
              <button type="button" class="pl-etiqueta-sug" data-e="${e}">${e}</button>`).join('')}
          </div>
        </div>
      </div>

      <!-- Ingredientes -->
      <div class="form-group">
        <label class="form-label">Ingredientes del inventario</label>
        <div id="pl-f-ingredientes">
          ${ingredientes.map((ing,i) => _buildIngredienteRow(ing, i, inventario)).join('')}
        </div>
        <button type="button" class="btn btn-secondary btn-sm mt-2" id="pl-f-add-ing">
          + Añadir ingrediente
        </button>
        <p class="form-hint">Opcional. Usa el catálogo de artículos para calcular la lista de la compra automáticamente.</p>
      </div>

      <!-- Activo -->
      <div class="form-group">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
          <input type="checkbox" id="pl-f-activo" ${plato?.activo!==false?'checked':''}/>
          <span class="form-label" style="margin:0">Plato activo (disponible para generar menús)</span>
        </label>
      </div>
    `;
  }

  /**
   * Construye una fila de ingrediente con buscador libre.
   * El ingrediente tiene: nombre (texto libre), categoria, cantidad, unidad.
   * Si el nombre coincide con un artículo del inventario, se vincula automáticamente
   * al generar la lista de compra. Si no existe, se crea como artículo nuevo al comprar.
   */
  function _buildIngredienteRow(ing, idx, inventario) {
    // Nombre: si viene de versión antigua con articuloId, resolvemos el nombre
    let nombreVal = ing?.nombre || '';
    if (!nombreVal && ing?.articuloId && inventario) {
      const art = inventario.find(a => a.id === ing.articuloId);
      if (art) nombreVal = art.nombre;
    }
    const categoriaVal = ing?.categoria || '';

    return `
      <div class="pl-ing-row" data-idx="${idx}">
        <div style="flex:3;position:relative">
          <input class="form-control pl-ing-nombre" type="text"
                 placeholder="Nombre ingrediente" value="${UI.escapeHtml(nombreVal)}"
                 data-field="nombre" autocomplete="off"/>
          <div class="pl-ing-suggestions hidden" id="pl-ing-sugg-${idx}"></div>
        </div>
        <input class="form-control pl-ing-cat" type="text"
               style="flex:2;min-width:80px" placeholder="Categoría"
               value="${UI.escapeHtml(categoriaVal)}" data-field="categoria"/>
        <input class="form-control pl-ing-qty" type="number" min="0" step="0.1"
               style="flex:1;min-width:56px" placeholder="Cant." value="${ing?.cantidad||''}"
               data-field="cantidad"/>
        <select class="form-control pl-ing-unit" style="flex:1;min-width:60px" data-field="unidad">
          ${['UN','KG','GR','L','ML','PAQ'].map(u=>`<option ${ing?.unidad===u?'selected':''}>${u}</option>`).join('')}
        </select>
        <button type="button" class="btn btn-danger btn-sm pl-ing-rm" data-idx="${idx}">✕</button>
      </div>`;
  }

  function _initFormEvents(inventario) {
    // Toggle notificación
    const notifCb = document.getElementById('pl-f-notif-cb');
    const notifBlock = document.getElementById('pl-f-notif-block');
    notifCb?.addEventListener('change', () => {
      if (notifBlock) notifBlock.style.display = notifCb.checked ? '' : 'none';
    });

    // Chips tipo menú (multi-select, excepto "todos" que es exclusivo)
    document.querySelectorAll('.pl-chip-tipomenu').forEach(chip => {
      chip.addEventListener('click', () => {
        if (chip.dataset.val === 'todos') {
          document.querySelectorAll('.pl-chip-tipomenu').forEach(c => c.classList.remove('active'));
          chip.classList.add('active');
        } else {
          document.querySelector('.pl-chip-tipomenu[data-val="todos"]')?.classList.remove('active');
          chip.classList.toggle('active');
          if (!document.querySelector('.pl-chip-tipomenu.active')) chip.classList.add('active');
        }
      });
    });

    // Chips tipo plato (single-select)
    document.querySelectorAll('.pl-chip-tipoplato').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('.pl-chip-tipoplato').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
      });
    });

    // Chips tipo comida (single-select)
    document.querySelectorAll('.pl-chip-tipocomida').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('.pl-chip-tipocomida').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
      });
    });

    // Etiquetas sugeridas
    document.querySelectorAll('.pl-etiqueta-sug').forEach(btn => {
      btn.addEventListener('click', () => _addEtiqueta(btn.dataset.e));
    });

    // Eliminar etiqueta
    document.getElementById('pl-f-etiquetas-selected')?.addEventListener('click', (e) => {
      const rm = e.target.closest('.pl-etiqueta-rm');
      if (rm) _removeEtiqueta(rm.dataset.e);
    });

    // Ingredientes
    document.getElementById('pl-f-add-ing')?.addEventListener('click', () => {
      const container = document.getElementById('pl-f-ingredientes');
      const idx = container.querySelectorAll('.pl-ing-row').length;
      const wrapper = document.createElement('div');
      wrapper.innerHTML = _buildIngredienteRow(null, idx, inventario);
      container.appendChild(wrapper.firstElementChild);
      _bindIngRemove();
      _bindIngAutocomplete(inventario);
      // Foco en el nuevo campo
      container.querySelector(`.pl-ing-row:last-child .pl-ing-nombre`)?.focus();
    });

    _bindIngRemove();
    _bindIngAutocomplete(inventario);
  }

  function _bindIngRemove() {
    document.querySelectorAll('.pl-ing-rm').forEach(btn => {
      btn.onclick = () => btn.closest('.pl-ing-row').remove();
    });
  }

  /**
   * Vincula el autocomplete de nombre de ingrediente a todos los campos actuales.
   * Sugiere nombres del inventario pero permite escribir cualquier cosa.
   * Al seleccionar un artículo del inventario, rellena también la categoría.
   */
  function _bindIngAutocomplete(inventario) {
    document.querySelectorAll('.pl-ing-nombre').forEach(input => {
      const row  = input.closest('.pl-ing-row');
      const idx  = row?.dataset.idx;
      const sugg = document.getElementById(`pl-ing-sugg-${idx}`);
      if (!sugg) return;

      input.addEventListener('input', () => {
        const val = input.value.toLowerCase().trim();
        if (!val || !inventario?.length) { sugg.classList.add('hidden'); return; }
        const matches = inventario.filter(a => a.nombre.toLowerCase().includes(val)).slice(0, 6);
        if (!matches.length) { sugg.classList.add('hidden'); return; }
        sugg.innerHTML = matches.map(a =>
          `<div class="categoria-option" data-nombre="${UI.escapeHtml(a.nombre)}" data-cat="${UI.escapeHtml(a.categoria||'')}">
            ${UI.escapeHtml(a.nombre)} <span style="color:var(--color-text-muted);font-size:11px">${UI.escapeHtml(a.categoria||'')}</span>
           </div>`
        ).join('');
        sugg.classList.remove('hidden');
        sugg.querySelectorAll('.categoria-option').forEach(opt => {
          opt.addEventListener('click', () => {
            input.value = opt.dataset.nombre;
            // Rellena categoría automáticamente
            const catInput = row?.querySelector('.pl-ing-cat');
            if (catInput && opt.dataset.cat) catInput.value = opt.dataset.cat;
            sugg.classList.add('hidden');
          });
        });
      });

      document.addEventListener('click', (e) => {
        if (!input.contains(e.target) && !sugg.contains(e.target)) sugg.classList.add('hidden');
      });
    });
  }

  function _addEtiqueta(etiqueta) {
    const container = document.getElementById('pl-f-etiquetas-selected');
    if (!container) return;
    if (container.querySelector(`[data-e="${etiqueta}"]`)) return; // ya existe
    const span = document.createElement('span');
    span.className = 'pl-etiqueta pl-etiqueta--editable';
    span.dataset.e = etiqueta;
    span.innerHTML = `${UI.escapeHtml(etiqueta)} <button class="pl-etiqueta-rm" data-e="${UI.escapeHtml(etiqueta)}">×</button>`;
    container.appendChild(span);
  }

  function _removeEtiqueta(etiqueta) {
    document.querySelector(`#pl-f-etiquetas-selected [data-e="${etiqueta}"]`)?.remove();
  }

  async function _submitForm(platoOriginal) {
    const nombre = document.getElementById('pl-f-nombre')?.value.trim();
    if (!nombre) { UI.showToast('El nombre es obligatorio','error'); return; }

    // tipoMenu
    const tipoMenu = [...document.querySelectorAll('.pl-chip-tipomenu.active')].map(c=>c.dataset.val);
    if (!tipoMenu.length) { UI.showToast('Selecciona para quién es el plato','error'); return; }

    // tipoPlato
    const tipoPlato = document.querySelector('.pl-chip-tipoplato.active')?.dataset.val || 'unico';

    // tipoComida
    const tipoComida = [document.querySelector('.pl-chip-tipocomida.active')?.dataset.val || 'ambos'];

    const frecuencia = parseInt(document.getElementById('pl-f-freq')?.value)||2;
    const repetir    = document.getElementById('pl-f-repetir')?.checked || false;
    const notifCb    = document.getElementById('pl-f-notif-cb')?.checked;
    const notifTexto = document.getElementById('pl-f-notif-texto')?.value.trim()||null;
    const notifHoras = parseInt(document.getElementById('pl-f-notif-horas')?.value)||16;
    const activo     = document.getElementById('pl-f-activo')?.checked !== false;

    // Etiquetas
    const etiquetas = [...document.querySelectorAll('#pl-f-etiquetas-selected [data-e]')]
      .map(el => el.dataset.e).filter(Boolean);

    // Ingredientes — nombre libre + categoría + cantidad + unidad
    const ingredientes = [];
    document.querySelectorAll('#pl-f-ingredientes .pl-ing-row').forEach(row => {
      const nombre   = row.querySelector('[data-field="nombre"]')?.value.trim();
      const categoria= row.querySelector('[data-field="categoria"]')?.value.trim()||'Otros';
      const cantidad = parseFloat(row.querySelector('[data-field="cantidad"]')?.value);
      const unidad   = row.querySelector('[data-field="unidad"]')?.value;
      if (nombre) {
        ingredientes.push({ nombre, categoria, cantidad: isNaN(cantidad)?1:cantidad, unidad });
      }
    });

    const state = App.getState();
    const platos = [...(state.platos||[])];
    const ahora = new Date().toISOString();

    const datos = {
      nombre, tipoMenu, tipoPlato, tipoComida,
      frecuenciaMinSemanas: frecuencia,
      permiteRepeticion: repetir,
      notificacionPrevia: notifCb ? notifTexto : null,
      horasNotificacionPrevia: notifCb ? notifHoras : null,
      etiquetas, ingredientes, activo,
      actualizadoEn: ahora,
    };

    if (platoOriginal) {
      const idx = platos.findIndex(p => p.id===platoOriginal.id);
      if (idx===-1) return;
      platos[idx] = {...platos[idx], ...datos};
      UI.showToast(`${nombre} actualizado`,'success');
    } else {
      platos.push({
        id:`plato-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
        ...datos,
      });
      UI.showToast(`${nombre} añadido al catálogo`,'success');
    }

    await App.setState('platos', platos);
    _renderList();
  }

  // ── Utils ────────────────────────────────────────────────────────

  function _ensureView() {
    if (!document.getElementById('view-platos')) {
      const v = document.createElement('div');
      v.id = 'view-platos'; v.className = 'view';
      document.getElementById('app-content')?.appendChild(v);
    }
  }

  return { render, openForm };

})();
