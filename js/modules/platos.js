/**
 * MenuApp — Módulo de Catálogo de Platos (Fase 2 + mejoras)
 *
 * Cambios:
 * - Fix duplicado etiquetas (lectura y renderizado)
 * - Campo raciones por plato
 * - Botón "Cargar receta desde link" con Claude API
 * - Badge plato de prueba (<4 semanas)
 * - Etiquetas de grupo alimenticio para equilibrio nutricional
 *
 * @module Platos
 */

const Platos = (() => {

  let _filtroTexto     = '';
  let _filtroTipoMenu  = 'todos';
  let _filtroTipoPlato = 'todos';
  let _filtroComida    = 'todos';

  const TIPO_MENU  = { todos:'Todos', mayores:'Adultos', bebe:'Bebé' };
  const TIPO_PLATO = { todos:'Todos', unico:'Plato único', primero:'Primero', segundo:'Segundo' };
  const TIPO_COMIDA= { todos:'Todos', comida:'Comida', cena:'Cena', ambos:'Ambos' };

  // Etiquetas de grupo alimenticio para el equilibrio nutricional
  const ETIQUETAS_GRUPOS = [
    'verdura','legumbre','pescado-blanco','pescado-azul','carne-ave',
    'carne-roja','huevo','hidratos','ensalada',
  ];

  const ETIQUETAS_SUGERIDAS = [
    'verdura','legumbre','pescado-blanco','pescado-azul','carne-ave','carne-roja',
    'huevo','hidratos','ensalada','sopa','guiso','rápido','bebé',
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

      <div class="search-bar" style="margin-bottom:var(--space-3)">
        <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
        </svg>
        <input type="search" id="pl-search" placeholder="Buscar plato..."
               value="${UI.escapeHtml(_filtroTexto)}" autocomplete="off"/>
      </div>

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

      <div id="pl-summary" class="pl-summary"></div>
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
      // Normaliza tipoMenu a Set para comparación robusta (aunque haya duplicados en el JSON)
      const tipoMenuSet = new Set(p.tipoMenu || ['todos']);

      let matchMenu = true;
      if (_filtroTipoMenu === 'mayores') {
        matchMenu = tipoMenuSet.has('mayores') || tipoMenuSet.has('todos');
      } else if (_filtroTipoMenu === 'bebe') {
        matchMenu = tipoMenuSet.has('bebe') || tipoMenuSet.has('todos');
      }
      // _filtroTipoMenu === 'todos' → matchMenu = true

      const matchPlato  = _filtroTipoPlato === 'todos' || p.tipoPlato === _filtroTipoPlato;

      const tipoComidaSet = new Set(p.tipoComida || ['ambos']);
      const matchComida = _filtroComida === 'todos' ||
        tipoComidaSet.has(_filtroComida) || tipoComidaSet.has('ambos');

      const matchText = !_filtroTexto ||
        p.nombre.toLowerCase().includes(_filtroTexto) ||
        (p.etiquetas||[]).some(e => e.toLowerCase().includes(_filtroTexto));

      return matchMenu && matchPlato && matchComida && matchText;
    });

    if (summary) {
      const activos   = items.filter(p => p.activo !== false).length;
      const prueba    = items.filter(p => _esPlatoPrueba(p)).length;
      const inactivos = items.filter(p => p.activo === false).length;
      summary.innerHTML = items.length > 0 ? `
        <div class="pl-summary-bar">
          <span class="badge badge-green">${activos} activo${activos!==1?'s':''}</span>
          ${prueba>0?`<span class="badge badge-orange">🧪 ${prueba} en prueba</span>`:''}
          ${inactivos>0?`<span class="badge badge-gray">${inactivos} inactivo${inactivos!==1?'s':''}</span>`:''}
          <span class="text-muted text-xs" style="margin-left:auto">${filtered.length} mostrado${filtered.length!==1?'s':''}</span>
        </div>` : '';
    }

    if (filtered.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">🍽️</div>
          <h2 class="empty-state-title">${items.length === 0 ? 'Sin platos' : 'Sin resultados'}</h2>
          <p class="empty-state-desc">
            ${items.length === 0
              ? 'Añade tus platos habituales para que el generador pueda crear menús.'
              : 'Ningún plato coincide con los filtros.'}
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

  function _esPlatoPrueba(plato) {
    if (!plato.creadoDesdeLink) return false;
    const semanas = (Date.now() - new Date(plato.actualizadoEn||plato.creadoEn||0)) / (1000*60*60*24*7);
    return semanas < 4;
  }

  function _buildCard(plato) {
    const inactivo = plato.activo === false;
    const esPrueba = _esPlatoPrueba(plato);

    const tipoMenuLabel = (plato.tipoMenu||[]).map(t => ({
      mayores:'👨 Adultos', bebe:'👶 Bebé', todos:'👨👶 Todos'
    }[t]||t)).join(', ');

    const tipoComidaLabel = (plato.tipoComida||[]).map(t => ({
      comida:'🍽 Comida', cena:'🌙 Cena', ambos:'🍽🌙 Ambos'
    }[t]||t)).join(', ');

    const tipoPlatoLabel = { unico:'Plato único', primero:'Primero', segundo:'Segundo' }[plato.tipoPlato] || plato.tipoPlato;
    const numIng = (plato.ingredientes||[]).length;
    const raciones = plato.raciones || null;

    // Etiquetas únicas (fix duplicados)
    const etiquetasUnicas = [...new Set(plato.etiquetas||[])];

    return `
      <div class="pl-card ${inactivo?'pl-card--inactivo':''}" data-id="${plato.id}">
        <div class="pl-card-header">
          <div class="pl-card-titulo">
            <span class="pl-card-nombre">${UI.escapeHtml(plato.nombre)}</span>
            ${inactivo?'<span class="badge badge-gray">Inactivo</span>':''}
            ${esPrueba?'<span class="badge badge-orange">🧪 Prueba</span>':''}
          </div>
          <button class="pl-toggle-btn" data-id="${plato.id}">
            <div class="pl-toggle ${inactivo?'':'pl-toggle--on'}"></div>
          </button>
        </div>

        <div class="pl-card-badges">
          <span class="badge badge-blue">${tipoPlatoLabel}</span>
          <span class="badge badge-gray">${tipoMenuLabel}</span>
          <span class="badge badge-gray">${tipoComidaLabel}</span>
          ${raciones?`<span class="badge badge-gray">🍽 ${raciones} raciones</span>`:''}
          ${plato.frecuenciaMinSemanas?`<span class="badge badge-gray">↻ cada ${plato.frecuenciaMinSemanas}sem</span>`:''}
          ${plato.permiteRepeticion?`<span class="badge badge-green">↻ repite</span>`:''}
          ${plato.diasSobras?`<span class="badge badge-blue">🍲 ${plato.diasSobras}d sobras</span>`:''}
          ${plato.preparacionFacil?`<span class="badge badge-green">⚡ Fácil</span>`:''}
        </div>

        ${etiquetasUnicas.length>0?`
          <div class="pl-card-etiquetas">
            ${etiquetasUnicas.map(e=>`<span class="pl-etiqueta">${UI.escapeHtml(e)}</span>`).join('')}
          </div>`:''}

        <div class="pl-card-meta">
          ${numIng>0?`<span class="pl-meta-item">🥕 ${numIng} ingrediente${numIng!==1?'s':''}</span>`:''}
          ${plato.notificacionPrevia?`<span class="pl-meta-item">🔔 ${plato.horasNotificacionPrevia||24}h antes</span>`:''}
          ${plato.linkReceta?`<a href="${UI.escapeHtml(plato.linkReceta)}" target="_blank" class="pl-meta-item btn-text" style="font-size:var(--font-size-xs)">🎬 Ver receta</a>`:''}
        </div>

        <div class="inv-card-actions">
          <button class="inv-action-btn pl-action-edit" data-id="${plato.id}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            Editar
          </button>
          <button class="inv-action-btn inv-action-delete" data-id="${plato.id}">
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
    const catalogo = Articulos.getCatalogo();
    const container = document.createElement('div');
    container.innerHTML = _buildForm(plato, catalogo);
    let modalRef = null;
    modalRef = UI.showModal({
      title: plato?`Editar — ${plato.nombre}`:'Añadir plato',
      content: container,
      buttons:[
        {label:'Cancelar',type:'secondary'},
        {label:plato?'Guardar cambios':'Añadir plato',type:'primary',onClick:async()=>{
          const ok = await _submitForm(plato, container);
          if(ok && modalRef) modalRef.close();
        }},
      ],
    });
    setTimeout(()=>_initFormEvents(catalogo, container),50);
  }

  function _buildForm(plato, catalogo) {
    const tiposMenu  = ['mayores','bebe','todos'];
    const tiposPlato = ['unico','primero','segundo'];
    const tiposComida= ['comida','cena','ambos'];
    const tieneNotif = !!plato?.notificacionPrevia;
    const ingredientes= plato?.ingredientes||[];
    // Etiquetas únicas al cargar el formulario
    const etiquetasIniciales = [...new Set(plato?.etiquetas||[])];

    return `
      <!-- Cargar desde link -->
      <div class="form-group">
        <button type="button" class="btn btn-secondary btn-full" id="pl-btn-link-receta">
          🎬 Cargar receta desde link (YouTube / Instagram / web)
        </button>
        <div id="pl-link-block" class="hidden" style="margin-top:var(--space-3)">
          <div style="display:flex;gap:var(--space-2)">
            <input class="form-control" id="pl-link-input" type="url" placeholder="https://..."/>
            <button type="button" class="btn btn-primary" id="pl-link-analizar" style="flex-shrink:0">Analizar</button>
          </div>
          <p class="form-hint">La IA extraerá los ingredientes y datos del plato automáticamente.</p>
          <div id="pl-link-status" class="hidden"></div>
        </div>
      </div>

      <hr style="border:none;border-top:1px solid var(--color-border);margin:var(--space-3) 0"/>

      <!-- Nombre -->
      <div class="form-group">
        <label class="form-label" for="pl-f-nombre">Nombre del plato <span class="required">*</span></label>
        <input class="form-control" id="pl-f-nombre" type="text"
               value="${UI.escapeHtml(plato?.nombre||'')}" placeholder="Ej: Cocido madrileño..." autocomplete="off"/>
      </div>

      <!-- Link receta guardado -->
      <div class="form-group" id="pl-link-guardado-block" style="${plato?.linkReceta?'':'display:none'}">
        <label class="form-label">Link de la receta</label>
        <input class="form-control" id="pl-f-link" type="url" value="${UI.escapeHtml(plato?.linkReceta||'')}"/>
      </div>

      <!-- Para quién -->
      <div class="form-group">
        <label class="form-label">Para quién <span class="required">*</span></label>
        <div class="pl-chips pl-chips--form">
          ${tiposMenu.map(t=>`
            <button type="button" class="pl-chip pl-chip-tipomenu ${(plato?.tipoMenu||['todos']).includes(t)?'active':''}" data-val="${t}">
              ${{mayores:'👨 Adultos',bebe:'👶 Bebé',todos:'👨👶 Todos'}[t]}
            </button>`).join('')}
        </div>
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

      <!-- Momento -->
      <div class="form-group">
        <label class="form-label">Momento <span class="required">*</span></label>
        <div class="pl-chips pl-chips--form">
          ${tiposComida.map(t=>`
            <button type="button" class="pl-chip pl-chip-tipocomida ${(plato?.tipoComida||['ambos']).includes(t)?'active':''}" data-val="${t}">
              ${{comida:'🍽 Comida',cena:'🌙 Cena',ambos:'🍽🌙 Ambos'}[t]}
            </button>`).join('')}
        </div>
      </div>

      <!-- Raciones -->
      <div class="form-group">
        <label class="form-label" for="pl-f-raciones">Raciones que sale la receta</label>
        <input class="form-control" id="pl-f-raciones" type="number" min="1" max="20"
               value="${plato?.raciones||2}" placeholder="2"/>
        <p class="form-hint">Cuántas raciones produce. Se usa para calcular cantidades de compra y sobras.</p>
      </div>

      <!-- Opciones de repetición y sobras -->
      <div class="form-group">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
          <input type="checkbox" id="pl-f-repetir" ${plato?.permiteRepeticion?'checked':''}/>
          <span class="form-label" style="margin:0">Puede repetirse en la misma semana</span>
        </label>
        <p class="form-hint">Actívalo para verduras habituales (ensalada, brócoli...).</p>
      </div>

      <div class="form-group">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
          <input type="checkbox" id="pl-f-sobras-cb" ${plato?.diasSobras?'checked':''}/>
          <span class="form-label" style="margin:0">🍲 Se cocinan raciones de más (sobras para bebé)</span>
        </label>
      </div>
      <div class="form-group" id="pl-f-sobras-block" style="${plato?.diasSobras?'':'display:none'}">
        <label class="form-label" for="pl-f-sobras-dias">Días extra que cubre para el bebé</label>
        <input class="form-control" id="pl-f-sobras-dias" type="number" min="1" max="6"
               value="${plato?.diasSobras||2}"/>
      </div>

      <!-- Preparación fácil -->
      <div class="form-group">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
          <input type="checkbox" id="pl-f-facil" ${plato?.preparacionFacil?'checked':''}/>
          <span class="form-label" style="margin:0">⚡ Preparación fácil</span>
        </label>
        <p class="form-hint">Ensaladas, tortillas, bocadillos... El generador los prioriza en días fáciles.</p>
      </div>

      <!-- Frecuencia -->
      <div class="form-group">
        <label class="form-label" for="pl-f-freq">Semanas mínimas entre repeticiones</label>
        <input class="form-control" id="pl-f-freq" type="number" min="1" max="12"
               value="${plato?.frecuenciaMinSemanas||2}"/>
      </div>

      <!-- Notificación previa -->
      <div class="form-group">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
          <input type="checkbox" id="pl-f-notif-cb" ${tieneNotif?'checked':''}/>
          <span class="form-label" style="margin:0">Requiere preparación previa</span>
        </label>
      </div>
      <div id="pl-f-notif-block" style="${tieneNotif?'':'display:none'}">
        <div class="form-group">
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
        <label class="form-label">Etiquetas (grupo alimenticio y características)</label>
        <div class="pl-etiquetas-editor">
          <div id="pl-f-etiquetas-selected" class="pl-etiquetas-selected">
            ${etiquetasIniciales.map(e=>`
              <span class="pl-etiqueta pl-etiqueta--editable" data-etiqueta="${UI.escapeHtml(e)}">
                ${UI.escapeHtml(e)}
                <button type="button" class="pl-etiqueta-rm" data-rm="${UI.escapeHtml(e)}">×</button>
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
        <label class="form-label">Ingredientes del catálogo</label>
        <div id="pl-f-ingredientes">
          ${ingredientes.map((ing,i) => _buildIngredienteRow(ing, i, catalogo)).join('')}
        </div>
        <button type="button" class="btn btn-secondary btn-sm mt-2" id="pl-f-add-ing">
          + Añadir ingrediente
        </button>
        <p class="form-hint">Permite calcular la lista de la compra y las cantidades según raciones.</p>
      </div>

      <!-- Activo -->
      <div class="form-group">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
          <input type="checkbox" id="pl-f-activo" ${plato?.activo!==false?'checked':''}/>
          <span class="form-label" style="margin:0">Plato activo</span>
        </label>
      </div>
    `;
  }

  function _buildIngredienteRow(ing, idx, catalogo) {
    let nombreVal = ing?.nombre || '';
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

  function _initFormEvents(catalogo, container) {
    // Toggle notif
    const notifCb=document.getElementById('pl-f-notif-cb');
    const notifBlock=document.getElementById('pl-f-notif-block');
    notifCb?.addEventListener('change',()=>{ if(notifBlock) notifBlock.style.display=notifCb.checked?'':'none'; });

    // Toggle sobras
    const sobrasCb=document.getElementById('pl-f-sobras-cb');
    const sobrasBlock=document.getElementById('pl-f-sobras-block');
    sobrasCb?.addEventListener('change',()=>{ if(sobrasBlock) sobrasBlock.style.display=sobrasCb.checked?'':'none'; });

    // Chips tipoMenu
    container.querySelectorAll('.pl-chip-tipomenu').forEach(chip=>{
      chip.addEventListener('click',()=>{
        if(chip.dataset.val==='todos'){
          container.querySelectorAll('.pl-chip-tipomenu').forEach(c=>c.classList.remove('active'));
          chip.classList.add('active');
        } else {
          container.querySelector('.pl-chip-tipomenu[data-val="todos"]')?.classList.remove('active');
          chip.classList.toggle('active');
          if(!container.querySelector('.pl-chip-tipomenu.active')) chip.classList.add('active');
        }
      });
    });

    // Chips tipoPlato y tipoComida (single select)
    container.querySelectorAll('.pl-chip-tipoplato').forEach(chip=>{
      chip.addEventListener('click',()=>{
        container.querySelectorAll('.pl-chip-tipoplato').forEach(c=>c.classList.remove('active'));
        chip.classList.add('active');
      });
    });
    container.querySelectorAll('.pl-chip-tipocomida').forEach(chip=>{
      chip.addEventListener('click',()=>{
        container.querySelectorAll('.pl-chip-tipocomida').forEach(c=>c.classList.remove('active'));
        chip.classList.add('active');
      });
    });

    // Etiquetas sugeridas — usar delegación en el contenedor
    container.querySelector('.pl-etiquetas-sugeridas')?.addEventListener('click',(e)=>{
      const btn=e.target.closest('.pl-etiqueta-sug');
      if(btn) _addEtiqueta(btn.dataset.e, container);
    });

    // Eliminar etiqueta — delegación
    container.querySelector('#pl-f-etiquetas-selected')?.addEventListener('click',(e)=>{
      const rm=e.target.closest('.pl-etiqueta-rm');
      if(rm) rm.closest('.pl-etiqueta--editable')?.remove();
    });

    // Ingredientes
    container.querySelector('#pl-f-add-ing')?.addEventListener('click',()=>{
      const ingContainer=document.getElementById('pl-f-ingredientes');
      const idx=ingContainer.querySelectorAll('.pl-ing-row').length;
      const wrapper=document.createElement('div');
      wrapper.innerHTML=_buildIngredienteRow(null,idx,catalogo);
      ingContainer.appendChild(wrapper.firstElementChild);
      _bindIngRemove(ingContainer);
      _bindIngAutocomplete(ingContainer, catalogo);
      ingContainer.querySelector('.pl-ing-row:last-child .pl-ing-nombre')?.focus();
    });

    const ingContainer=document.getElementById('pl-f-ingredientes');
    if(ingContainer){
      _bindIngRemove(ingContainer);
      _bindIngAutocomplete(ingContainer, catalogo);
    }

    // Botón cargar desde link
    document.getElementById('pl-btn-link-receta')?.addEventListener('click',()=>{
      const block=document.getElementById('pl-link-block');
      block?.classList.toggle('hidden');
    });
    document.getElementById('pl-link-analizar')?.addEventListener('click',()=>_analizarLinkReceta(container));
  }

  function _addEtiqueta(etiqueta, container) {
    const sel = container.querySelector('#pl-f-etiquetas-selected');
    if(!sel) return;
    // Evita duplicados comprobando data-etiqueta
    if(sel.querySelector(`[data-etiqueta="${etiqueta}"]`)) return;
    const span=document.createElement('span');
    span.className='pl-etiqueta pl-etiqueta--editable';
    span.dataset.etiqueta=etiqueta;
    span.innerHTML=`${UI.escapeHtml(etiqueta)}<button type="button" class="pl-etiqueta-rm" data-rm="${UI.escapeHtml(etiqueta)}">×</button>`;
    sel.appendChild(span);
  }

  function _bindIngRemove(container) {
    container.querySelectorAll('.pl-ing-rm').forEach(btn=>{
      btn.onclick=()=>btn.closest('.pl-ing-row').remove();
    });
  }

  function _bindIngAutocomplete(container, catalogo) {
    container.querySelectorAll('.pl-ing-nombre').forEach(input=>{
      if(input._autocomplete) return; // ya vinculado
      input._autocomplete = true;
      const row=input.closest('.pl-ing-row');
      const idx=row?.dataset.idx;
      const sugg=document.getElementById(`pl-ing-sugg-${idx}`);
      if(!sugg) return;
      input.addEventListener('input',()=>{
        const val=input.value.toLowerCase().trim();
        if(!val||!catalogo?.length){ sugg.classList.add('hidden'); return; }
        const matches=catalogo.filter(a=>a.nombre.toLowerCase().includes(val)).slice(0,6);
        if(!matches.length){ sugg.classList.add('hidden'); return; }
        sugg.innerHTML=matches.map(a=>`
          <div class="categoria-option" data-nombre="${UI.escapeHtml(a.nombre)}" data-cat="${UI.escapeHtml(a.categoria||'')}">
            ${UI.escapeHtml(a.nombre)} <span style="color:var(--color-text-muted);font-size:11px">${UI.escapeHtml(a.categoria||'')}</span>
          </div>`).join('');
        sugg.classList.remove('hidden');
        sugg.querySelectorAll('.categoria-option').forEach(opt=>{
          opt.addEventListener('click',()=>{
            input.value=opt.dataset.nombre;
            const catInput=row?.querySelector('.pl-ing-cat');
            if(catInput&&opt.dataset.cat) catInput.value=opt.dataset.cat;
            sugg.classList.add('hidden');
          });
        });
      });
    });
  }

  // ── Cargar receta desde link con Claude API ──────────────────────

  async function _analizarLinkReceta(formContainer) {
    const link = document.getElementById('pl-link-input')?.value.trim();
    if (!link) { UI.showToast('Introduce un link válido','error'); return; }

    const apiKey = Storage.getSync('gemini_api_key');
    if (!apiKey) {
      UI.showToast('Configura tu API key de Gemini en Config → Cuenta','error', 5000);
      return;
    }

    const statusEl = document.getElementById('pl-link-status');
    const btn = document.getElementById('pl-link-analizar');
    const setStatus = (msg) => { if(statusEl){ statusEl.textContent=msg; statusEl.classList.remove('hidden'); } };

    if(btn) btn.disabled = true;
    setStatus('🤖 Analizando receta...');

    const esYoutube   = /youtube\.com|youtu\.be/i.test(link);
    const esInstagram = /instagram\.com/i.test(link);

    // Helper: llama a Gemini con un prompt dado
    async function callGemini(prompt, useSearch = true) {
      const contents = esYoutube
        ? [{ parts: [{ fileData: { mimeType:'video/mp4', fileUri: link } }, { text: prompt }] }]
        : [{ parts: [{ text: prompt }] }];

      const body = {
        contents,
        generationConfig: { temperature: 0.1, maxOutputTokens: 800 },
      };
      if (useSearch && !esYoutube) body.tools = [{ googleSearch: {} }];

      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) }
      );
      if (!r.ok) {
        const e = await r.json().catch(()=>({}));
        throw new Error(e?.error?.message || `HTTP ${r.status}`);
      }
      const data = await r.json();
      const parts = data?.candidates?.[0]?.content?.parts || [];
      return parts.map(p => p.text||'').join('').trim();
    }

    // Extrae el primer JSON válido de un texto
    function extraerJSON(text) {
      const start = text.indexOf('{');
      if (start === -1) return null;
      let str = text.slice(start);
      let depth=0, end=-1, inStr=false, esc=false;
      for (let i=0; i<str.length; i++) {
        const c = str[i];
        if (esc)       { esc=false; continue; }
        if (c==='\\')  { esc=true; continue; }
        if (c==='"')   { inStr=!inStr; continue; }
        if (inStr)     continue;
        if (c==='{')   depth++;
        else if (c==='}') { depth--; if(depth===0){ end=i; break; } }
      }
      if (end < 0) return null;
      try { return JSON.parse(str.slice(0, end+1)); } catch { return null; }
    }

    try {
      // ── Llamada 1: metadatos del plato ──────────────────────────
      setStatus('🤖 Paso 1/2 — Analizando el plato...');
      const fuenteDesc = esYoutube ? 'Analiza este vídeo de YouTube'
        : esInstagram ? 'Analiza esta publicación de Instagram'
        : 'Analiza esta receta web';

      const prompt1 = `${fuenteDesc}: ${link}

Devuelve SOLO un JSON con estos campos (sin markdown):
{"nombre":"string","raciones":4,"tipoPlato":"unico","tipoComida":["comida"],"tipoMenu":["todos"],"preparacionFacil":false,"notificacionPrevia":null,"etiquetas":["verdura"]}

tipoPlato: unico/primero/segundo
tipoComida: comida/cena/ambos
tipoMenu: mayores/bebe/todos
etiquetas (max 2): verdura, legumbre, pescado-blanco, pescado-azul, carne-ave, carne-roja, huevo, hidratos, ensalada`;

      const text1 = await callGemini(prompt1);
      const meta  = extraerJSON(text1);
      if (!meta?.nombre) throw new Error('No se pudo identificar el plato. Prueba con otra URL.');

      // ── Llamada 2: ingredientes ──────────────────────────────────
      setStatus('🤖 Paso 2/2 — Extrayendo ingredientes...');

      const prompt2 = `${fuenteDesc}: ${link}

Lista los ingredientes de la receta "${meta.nombre}".
Devuelve SOLO un JSON array (sin markdown, sin texto extra):
[{"nombre":"string","cantidad":1,"unidad":"UN","categoria":"Frutas y verduras"}]

unidad: UN, KG, GR, L, ML, PAQ
categoria: Frutas y verduras, Carnicería, Pescadería, Lácteos, Conservas, Legumbres, Especias, Aceites y vinagres, Salsas y condimentos, Pan y bollería, Repostería y panadería, Congelados, Bebidas

Máximo 12 ingredientes principales.`;

      const text2  = await callGemini(prompt2);
      console.log('[Gemini ING RAW]', JSON.stringify(text2?.slice(0, 600)));
      // Extrae array de ingredientes
      const startArr = text2.indexOf('[');
      const endArr   = text2.lastIndexOf(']');
      let ingredientes = [];
      if (startArr !== -1 && endArr > startArr) {
        try { ingredientes = JSON.parse(text2.slice(startArr, endArr+1)); } catch {}
      }

      // Combina resultado
      const receta = { ...meta, ingredientes: ingredientes || [] };

      _rellenarFormConReceta(receta, link, formContainer);
      setStatus('✓ Receta cargada correctamente');
      statusEl?.classList.add('status-ok');
      document.getElementById('pl-link-block')?.classList.add('hidden');

    } catch(err) {
      console.error('[Platos] Error Gemini:', err);
      const msg = err.message?.includes('API_KEY') ? 'API key inválida.'
                : err.message?.includes('quota')   ? 'Límite de uso alcanzado.'
                : err.message;
      if(statusEl){ statusEl.textContent=`❌ ${msg}`; statusEl.className='status-error'; }
      UI.showToast('Error al analizar la receta','error');
    } finally {
      if(btn) btn.disabled = false;
    }
  }


  function _rellenarFormConReceta(receta, link, formContainer) {
    const q  = id => formContainer.querySelector(`#${id}`);
    const qs = sel => formContainer.querySelector(sel);
    const qsa= sel => formContainer.querySelectorAll(sel);

    // Nombre
    const nombreEl = q('pl-f-nombre');
    if(nombreEl && receta.nombre) nombreEl.value = receta.nombre;

    // Raciones
    const racionesEl = q('pl-f-raciones');
    if(racionesEl && receta.raciones) racionesEl.value = receta.raciones;

    // tipoMenu chips — normaliza antes de aplicar
    if(receta.tipoMenu?.length){
      const valores = receta.tipoMenu.includes('todos') ? ['todos'] : receta.tipoMenu;
      qsa('.pl-chip-tipomenu').forEach(c=>c.classList.remove('active'));
      valores.forEach(v => qs(`.pl-chip-tipomenu[data-val="${v}"]`)?.classList.add('active'));
    }

    // tipoPlato chip
    if(receta.tipoPlato){
      qsa('.pl-chip-tipoplato').forEach(c=>c.classList.remove('active'));
      qs(`.pl-chip-tipoplato[data-val="${receta.tipoPlato}"]`)?.classList.add('active');
    }

    // tipoComida chip
    const momentoVal = Array.isArray(receta.tipoComida) ? receta.tipoComida[0] : receta.tipoComida;
    if(momentoVal){
      qsa('.pl-chip-tipocomida').forEach(c=>c.classList.remove('active'));
      qs(`.pl-chip-tipocomida[data-val="${momentoVal}"]`)?.classList.add('active');
    }

    // Preparación fácil
    const facilEl = q('pl-f-facil');
    if(facilEl) facilEl.checked = !!receta.preparacionFacil;

    // Notificación previa
    if(receta.notificacionPrevia){
      const notifCb = q('pl-f-notif-cb');
      const notifTxt = q('pl-f-notif-texto');
      const notifBlock = q('pl-f-notif-block');
      if(notifCb)    { notifCb.checked = true; }
      if(notifBlock) { notifBlock.style.display = ''; }
      if(notifTxt)   { notifTxt.value = receta.notificacionPrevia; }
    }

    // Etiquetas — limpia y rellena
    const etiquetasSel = q('pl-f-etiquetas-selected');
    if(etiquetasSel && receta.etiquetas?.length){
      etiquetasSel.innerHTML = '';
      [...new Set(receta.etiquetas)].forEach(e => _addEtiqueta(e, formContainer));
    }

    // Ingredientes
    const ingContainer = q('pl-f-ingredientes');
    if(ingContainer && receta.ingredientes?.length){
      ingContainer.innerHTML = '';
      const catalogo = Articulos.getCatalogo();
      receta.ingredientes.forEach((ing,i)=>{
        const wrapper = document.createElement('div');
        wrapper.innerHTML = _buildIngredienteRow(ing, i, catalogo);
        ingContainer.appendChild(wrapper.firstElementChild);
      });
      _bindIngRemove(ingContainer);
      _bindIngAutocomplete(ingContainer, catalogo);
    }

    // Link guardado
    const linkGuardadoBlock = q('pl-link-guardado-block');
    const linkInput = q('pl-f-link');
    if(linkGuardadoBlock) linkGuardadoBlock.style.display = '';
    if(linkInput) linkInput.value = link || '';
  }

  // ── Submit ───────────────────────────────────────────────────────

  async function _submitForm(platoOriginal, container) {
    // CRÍTICO: todos los querySelector usan container (scope del modal), nunca document
    // Esto evita leer valores acumulados de modales anteriores en el DOM

    const nombre = container.querySelector('#pl-f-nombre')?.value.trim();
    if (!nombre) { UI.showToast('El nombre es obligatorio','error'); return false; }

    // tipoMenu: puede ser múltiple, normaliza 'todos' como valor único
    const tipoMenuRaw = [...container.querySelectorAll('.pl-chip-tipomenu.active')].map(c=>c.dataset.val);
    const tipoMenu = tipoMenuRaw.includes('todos') ? ['todos'] : [...new Set(tipoMenuRaw)];
    if (!tipoMenu.length) { UI.showToast('Selecciona para quién es el plato','error'); return false; }

    // tipoPlato: single select
    const tipoPlato = container.querySelector('.pl-chip-tipoplato.active')?.dataset.val || 'unico';

    // tipoComida: single select, guardado como array por compatibilidad
    const tipoComidaVal = container.querySelector('.pl-chip-tipocomida.active')?.dataset.val || 'ambos';
    const tipoComida = [tipoComidaVal];

    const raciones   = parseInt(container.querySelector('#pl-f-raciones')?.value)||2;
    const frecuencia = parseInt(container.querySelector('#pl-f-freq')?.value)||2;
    const repetir    = container.querySelector('#pl-f-repetir')?.checked||false;
    const facil      = container.querySelector('#pl-f-facil')?.checked||false;
    const sobrasCb   = container.querySelector('#pl-f-sobras-cb')?.checked||false;
    const diasSobras = sobrasCb?(parseInt(container.querySelector('#pl-f-sobras-dias')?.value)||2):0;
    const notifCb    = container.querySelector('#pl-f-notif-cb')?.checked;
    const notifTexto = container.querySelector('#pl-f-notif-texto')?.value.trim()||null;
    const notifHoras = parseInt(container.querySelector('#pl-f-notif-horas')?.value)||16;
    const activo     = container.querySelector('#pl-f-activo')?.checked!==false;
    const linkReceta = container.querySelector('#pl-f-link')?.value.trim()||null;

    // Etiquetas únicas — scoped al container, usando data-etiqueta (no data-rm)
    const etiquetas = [...new Set(
      [...container.querySelectorAll('#pl-f-etiquetas-selected .pl-etiqueta--editable')]
        .map(el => el.dataset.etiqueta).filter(Boolean)
    )];

    // Ingredientes — scoped al container, deduplica por nombre (evita acumulación)
    const ingMap = new Map();
    container.querySelectorAll('#pl-f-ingredientes .pl-ing-row').forEach(row => {
      const nom = row.querySelector('[data-field="nombre"]')?.value.trim();
      if (!nom) return;
      const key = nom.toLowerCase();
      if (!ingMap.has(key)) {
        ingMap.set(key, {
          nombre: nom,
          categoria: row.querySelector('[data-field="categoria"]')?.value.trim()||'Otros',
          cantidad:  parseFloat(row.querySelector('[data-field="cantidad"]')?.value)||1,
          unidad:    row.querySelector('[data-field="unidad"]')?.value||'UN',
        });
      }
    });
    const ingredientes = [...ingMap.values()];

    const state = App.getState();
    const platos = [...(state.platos||[])];
    const ahora  = new Date().toISOString();

    const datos = {
      nombre, tipoMenu, tipoPlato, tipoComida, raciones,
      frecuenciaMinSemanas: frecuencia,
      permiteRepeticion: repetir,
      preparacionFacil: facil,
      diasSobras: diasSobras||0,
      notificacionPrevia: notifCb?notifTexto:null,
      horasNotificacionPrevia: notifCb?notifHoras:null,
      linkReceta: linkReceta||null,
      creadoDesdeLink: linkReceta?(platoOriginal?.creadoDesdeLink||ahora):null,
      etiquetas, ingredientes, activo,
      actualizadoEn: ahora,
    };

    if (platoOriginal) {
      const idx = platos.findIndex(p=>p.id===platoOriginal.id);
      if (idx===-1) return false;
      platos[idx] = {...platos[idx], ...datos};
      UI.showToast(`${nombre} actualizado`,'success');
    } else {
      platos.push({
        id:`plato-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
        creadoEn: ahora,
        ...datos,
      });
      UI.showToast(`${nombre} añadido al catálogo`,'success');
    }

    await App.setState('platos', platos);
    _renderList();
    return true;
  }


  function _renderList_after_submit() { _renderList(); }

  /**
   * Intenta reparar un JSON truncado cerrando strings y estructuras abiertas.
   */
  function _repairJSON(str) {
    let result = str.trim();
    // Elimina caracteres de control
    result = result.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    // Elimina coma final antes de } o ]
    result = result.replace(/,\s*([\]}])/g, '$1');

    // Cierra strings abiertos contando comillas no escapadas
    let inStr = false, lastStrStart = -1;
    for (let i = 0; i < result.length; i++) {
      if (result[i] === '\\') { i++; continue; }
      if (result[i] === '"') {
        if (!inStr) { inStr = true; lastStrStart = i; }
        else { inStr = false; lastStrStart = -1; }
      }
    }
    if (inStr) result += '"'; // cierra string abierto

    // Cierra arrays y objetos abiertos
    const stack = [];
    inStr = false;
    for (let i = 0; i < result.length; i++) {
      if (result[i] === '\\') { i++; continue; }
      if (result[i] === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (result[i] === '{') stack.push('}');
      else if (result[i] === '[') stack.push(']');
      else if (result[i] === '}' || result[i] === ']') stack.pop();
    }
    result += stack.reverse().join('');
    return result;
  }

  function _ensureView() {
    if (!document.getElementById('view-platos')) {
      const v=document.createElement('div');
      v.id='view-platos'; v.className='view';
      document.getElementById('app-content')?.appendChild(v);
    }
  }

  return { render, openForm };

})();
