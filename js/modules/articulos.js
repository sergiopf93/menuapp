/**
 * MenuApp — Módulo de Catálogo de Artículos (Fase 2b)
 *
 * Fuente de verdad de todos los artículos que existen en el mundo
 * de esta familia. Un artículo puede estar:
 *   - En el catálogo pero sin stock (cantidad 0 o no en inventario)
 *   - En el catálogo y en inventario (tiene stock en casa)
 *   - Como ingrediente de uno o varios platos
 *
 * Estructura de un artículo del catálogo:
 * {
 *   id:          string (UUID)
 *   nombre:      string
 *   categoria:   string  (sección del supermercado)
 *   unidad:      enum    (UN|KG|GR|L|ML|PAQ)
 *   paqueteMinimo: number (unidades mínimas de compra)
 *   notas:       string|null
 *   activo:      boolean
 *   actualizadoEn: datetime ISO
 * }
 *
 * @module Articulos
 */

const Articulos = (() => {

  // ── Estado local ─────────────────────────────────────────────────
  let _filtroTexto    = '';
  let _filtroCategoria = 'todas';

  const UNIDADES = ['UN','KG','GR','L','ML','PAQ','BOT','LT'];

  const CATEGORIAS_ORDEN = [
    'Frutas y verduras','Panadería','Charcutería','Carnicería',
    'Pescadería','Lácteos','Huevos','Congelados','Envasados',
    'Pasta, arroz y legumbres','Conservas','Aceites y condimentos',
    'Bebidas','Droguería','Otros',
  ];

  // ── API pública ──────────────────────────────────────────────────

  function render() {
    _ensureView();
    const view = document.getElementById('view-articulos');
    if (!view) return;
    view.innerHTML = _buildShell();
    _bindShellEvents();
    _renderList();
  }

  /**
   * Devuelve todos los artículos del catálogo activos.
   * Usado por el módulo de Platos para el selector de ingredientes.
   * @returns {Array}
   */
  function getCatalogo() {
    return (App.getState().catalogo || []).filter(a => a.activo !== false);
  }

  /**
   * Busca un artículo del catálogo por nombre (case-insensitive).
   * @param {string} nombre
   * @returns {object|null}
   */
  function findByNombre(nombre) {
    const lower = nombre.toLowerCase().trim();
    return (App.getState().catalogo || []).find(a => a.nombre.toLowerCase() === lower) || null;
  }

  // ── Shell ────────────────────────────────────────────────────────

  function _buildShell() {
    const catalogo = App.getState().catalogo || [];
    const categorias = _getCategoriasUsadas(catalogo);

    return `
      <div class="module-header">
        <h1 class="module-title">Artículos</h1>
        <button class="btn btn-primary btn-sm" id="art-btn-add">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="16" height="16">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          Añadir
        </button>
      </div>

      <p class="text-sm text-muted" style="margin-bottom:var(--space-4)">
        Todo lo que puedes comprar. Los ingredientes de los platos y la lista de la compra usan este catálogo.
      </p>

      <!-- Búsqueda -->
      <div class="search-bar" style="margin-bottom:var(--space-3)">
        <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
        </svg>
        <input type="search" id="art-search" placeholder="Buscar artículo..."
               value="${UI.escapeHtml(_filtroTexto)}" autocomplete="off"/>
      </div>

      <!-- Filtro por categoría -->
      <div class="inv-ubicacion-tabs" id="art-cat-tabs" style="margin-bottom:var(--space-4)">
        <button class="inv-tab ${_filtroCategoria==='todas'?'active':''}" data-cat="todas">📦 Todas</button>
        ${categorias.map(c =>
          `<button class="inv-tab ${_filtroCategoria===c?'active':''}" data-cat="${UI.escapeHtml(c)}">${UI.escapeHtml(c)}</button>`
        ).join('')}
      </div>

      <!-- Resumen -->
      <div id="art-summary"></div>

      <!-- Lista -->
      <div id="art-list"></div>
    `;
  }

  function _bindShellEvents() {
    document.getElementById('art-btn-add')?.addEventListener('click', () => openForm());

    let searchTimer;
    document.getElementById('art-search')?.addEventListener('input', (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        _filtroTexto = e.target.value.trim().toLowerCase();
        _renderList();
      }, 250);
    });

    document.getElementById('art-cat-tabs')?.addEventListener('click', (e) => {
      const btn = e.target.closest('.inv-tab');
      if (!btn) return;
      _filtroCategoria = btn.dataset.cat;
      document.querySelectorAll('#art-cat-tabs .inv-tab').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      _renderList();
    });
  }

  // ── Lista ────────────────────────────────────────────────────────

  function _renderList() {
    const container = document.getElementById('art-list');
    const summary   = document.getElementById('art-summary');
    if (!container) return;

    const catalogo = App.getState().catalogo || [];
    const inventario = App.getState().inventario || [];

    const filtered = catalogo.filter(a => {
      const matchCat  = _filtroCategoria === 'todas' || a.categoria === _filtroCategoria;
      const matchText = !_filtroTexto || a.nombre.toLowerCase().includes(_filtroTexto);
      return matchCat && matchText;
    });

    // Resumen
    if (summary) {
      summary.innerHTML = `
        <div class="inv-summary-bar" style="margin-bottom:var(--space-3)">
          <span class="badge badge-green">${catalogo.filter(a=>a.activo!==false).length} artículos</span>
          <span class="text-muted text-xs" style="margin-left:auto">${filtered.length} mostrado${filtered.length!==1?'s':''}</span>
        </div>`;
    }

    if (filtered.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">🛒</div>
          <h2 class="empty-state-title">${_filtroTexto?'Sin resultados':'Catálogo vacío'}</h2>
          <p class="empty-state-desc">
            ${catalogo.length === 0
              ? 'Añade los artículos que sueles comprar. Luego podrás usarlos como ingredientes de platos.'
              : 'Ningún artículo coincide con la búsqueda.'}
          </p>
          ${catalogo.length === 0 ? `<button class="btn btn-primary" id="art-empty-add">Añadir primer artículo</button>` : ''}
        </div>`;
      document.getElementById('art-empty-add')?.addEventListener('click', () => openForm());
      return;
    }

    // Agrupa por categoría en orden estándar
    const groups = {};
    filtered.forEach(a => {
      if (!groups[a.categoria]) groups[a.categoria] = [];
      groups[a.categoria].push(a);
    });

    // Ordena categorías según el orden estándar del supermercado
    const catsSorted = Object.keys(groups).sort((a, b) => {
      const ia = CATEGORIAS_ORDEN.indexOf(a);
      const ib = CATEGORIAS_ORDEN.indexOf(b);
      if (ia === -1 && ib === -1) return a.localeCompare(b, 'es');
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });

    container.innerHTML = catsSorted.map(cat => `
      <div class="inv-group">
        <h2 class="section-title">
          ${UI.escapeHtml(cat)}
          <span class="badge badge-gray" style="margin-left:6px">${groups[cat].length}</span>
        </h2>
        ${groups[cat]
          .sort((a,b) => a.nombre.localeCompare(b.nombre,'es'))
          .map(a => _buildCard(a, inventario))
          .join('')}
      </div>`).join('');

    _bindCardEvents(container);
  }

  function _buildCard(articulo, inventario) {
    const inactivo = articulo.activo === false;
    // Comprueba si tiene stock en inventario
    const stock = inventario.filter(i =>
      i.nombre.toLowerCase() === articulo.nombre.toLowerCase()
    );
    const tieneStock = stock.length > 0;
    const cantidadStock = stock.reduce((sum, i) => sum + (i.cantidad || 0), 0);
    const unidadStock   = stock[0]?.unidad || articulo.unidad;

    return `
      <div class="art-card ${inactivo?'pl-card--inactivo':''}" data-id="${articulo.id}">
        <div class="art-card-main">
          <div class="art-card-info">
            <div class="inv-card-name">${UI.escapeHtml(articulo.nombre)}</div>
            <div class="inv-card-meta">
              <span class="inv-card-categoria">${UI.escapeHtml(articulo.categoria)}</span>
              <span class="badge badge-gray">${articulo.unidad}</span>
              ${articulo.paqueteMinimo > 1
                ? `<span class="badge badge-gray">min ${articulo.paqueteMinimo}</span>` : ''}
              ${tieneStock
                ? `<span class="badge badge-green">✓ En casa: ${cantidadStock} ${unidadStock}</span>`
                : `<span class="badge badge-gray">Sin stock</span>`}
            </div>
            ${articulo.notas
              ? `<div class="inv-card-notas">${UI.escapeHtml(articulo.notas)}</div>` : ''}
          </div>
        </div>
        <div class="inv-card-actions">
          <button class="inv-action-btn inv-action-edit" data-id="${articulo.id}" title="Editar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            Editar
          </button>
          <button class="inv-action-btn inv-action-delete" data-id="${articulo.id}" title="Eliminar">
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
      if      (e.target.closest('.inv-action-edit'))   openForm(id);
      else if (e.target.closest('.inv-action-delete')) await _deleteArticulo(id);
    });
  }

  // ── Eliminar ─────────────────────────────────────────────────────

  async function _deleteArticulo(id) {
    const state = App.getState();
    const art = (state.catalogo||[]).find(a => a.id===id);
    if (!art) return;
    const ok = await UI.confirm(
      `¿Eliminar <strong>${UI.escapeHtml(art.nombre)}</strong> del catálogo?<br>
       <span class="text-sm text-muted">Los platos que lo usen como ingrediente mantendrán el nombre pero perderán el vínculo.</span>`,
      'Eliminar'
    );
    if (!ok) return;
    const catalogo = (state.catalogo||[]).filter(a => a.id!==id);
    await App.setState('catalogo', catalogo);
    UI.showToast(`${art.nombre} eliminado del catálogo`,'success');
    _renderList();
  }

  // ── Formulario ───────────────────────────────────────────────────

  function openForm(id=null) {
    const state = App.getState();
    const art = id?(state.catalogo||[]).find(a=>a.id===id):null;
    const container = document.createElement('div');
    container.innerHTML = _buildForm(art);
    UI.showModal({
      title: art?`Editar — ${art.nombre}`:'Añadir artículo al catálogo',
      content: container,
      buttons:[
        {label:'Cancelar',type:'secondary'},
        {label:art?'Guardar cambios':'Añadir',type:'primary',onClick:()=>_submitForm(art)},
      ],
    });
    setTimeout(_initFormEvents, 100);
  }

  function _buildForm(art) {
    return `
      <div class="form-group">
        <label class="form-label" for="art-f-nombre">Nombre <span class="required">*</span></label>
        <input class="form-control" id="art-f-nombre" type="text"
               value="${UI.escapeHtml(art?.nombre||'')}"
               placeholder="Ej: Cebolla, Lubina, Leche entera..." autocomplete="off"/>
      </div>

      <div class="form-group">
        <label class="form-label" for="art-f-cat">Categoría / Sección del supermercado <span class="required">*</span></label>
        <div style="position:relative">
          <input class="form-control" id="art-f-cat" type="text"
                 value="${UI.escapeHtml(art?.categoria||'')}"
                 placeholder="Ej: Frutas y verduras, Pescadería..." autocomplete="off"/>
          <div id="art-f-cat-sugg" class="categoria-suggestions hidden"></div>
        </div>
      </div>

      <div style="display:flex;gap:var(--space-3)">
        <div class="form-group" style="flex:1">
          <label class="form-label" for="art-f-unidad">Unidad habitual</label>
          <select class="form-control" id="art-f-unidad">
            ${UNIDADES.map(u=>`<option ${art?.unidad===u?'selected':''}>${u}</option>`).join('')}
          </select>
        </div>
        <div class="form-group" style="flex:1">
          <label class="form-label" for="art-f-paquete">Unidades mínimas de compra</label>
          <input class="form-control" id="art-f-paquete" type="number"
                 min="1" step="1" value="${art?.paqueteMinimo||1}"/>
          <p class="form-hint">Ej: 6 huevos, 1 brick leche.</p>
        </div>
      </div>

      <div class="form-group">
        <label class="form-label" for="art-f-notas">Notas</label>
        <textarea class="form-control" id="art-f-notas" rows="2"
                  placeholder="Ej: Mejor marca X, sin gluten..."
        >${UI.escapeHtml(art?.notas||'')}</textarea>
      </div>

      <div class="form-group">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
          <input type="checkbox" id="art-f-activo" ${art?.activo!==false?'checked':''}/>
          <span class="form-label" style="margin:0">Artículo activo</span>
        </label>
      </div>
    `;
  }

  function _initFormEvents() {
    const catInput = document.getElementById('art-f-cat');
    const catSugg  = document.getElementById('art-f-cat-sugg');
    if (!catInput || !catSugg) return;

    catInput.addEventListener('input', () => {
      const val = catInput.value.toLowerCase();
      if (!val) { catSugg.classList.add('hidden'); return; }
      const matches = CATEGORIAS_ORDEN.filter(c => c.toLowerCase().includes(val));
      if (!matches.length) { catSugg.classList.add('hidden'); return; }
      catSugg.innerHTML = matches.map(c =>
        `<div class="categoria-option" data-v="${UI.escapeHtml(c)}">${UI.escapeHtml(c)}</div>`
      ).join('');
      catSugg.classList.remove('hidden');
      catSugg.querySelectorAll('.categoria-option').forEach(o => {
        o.addEventListener('click', () => { catInput.value=o.dataset.v; catSugg.classList.add('hidden'); });
      });
    });
    document.addEventListener('click', (e) => {
      if (!catInput.contains(e.target)) catSugg.classList.add('hidden');
    });
  }

  async function _submitForm(artOriginal) {
    const nombre   = document.getElementById('art-f-nombre')?.value.trim();
    const categoria= document.getElementById('art-f-cat')?.value.trim();
    const unidad   = document.getElementById('art-f-unidad')?.value;
    const paquete  = parseInt(document.getElementById('art-f-paquete')?.value)||1;
    const notas    = document.getElementById('art-f-notas')?.value.trim()||null;
    const activo   = document.getElementById('art-f-activo')?.checked !== false;

    if (!nombre)    { UI.showToast('El nombre es obligatorio','error'); return; }
    if (!categoria) { UI.showToast('La categoría es obligatoria','error'); return; }

    const state = App.getState();
    const catalogo = [...(state.catalogo||[])];
    const ahora = new Date().toISOString();

    // Comprueba duplicados por nombre
    const duplicado = catalogo.find(a =>
      a.nombre.toLowerCase()===nombre.toLowerCase() && a.id!==(artOriginal?.id)
    );
    if (duplicado) { UI.showToast(`Ya existe "${nombre}" en el catálogo`,'error'); return; }

    if (artOriginal) {
      const idx = catalogo.findIndex(a=>a.id===artOriginal.id);
      if (idx===-1) return;
      catalogo[idx]={...catalogo[idx],nombre,categoria,unidad,paqueteMinimo:paquete,notas,activo,actualizadoEn:ahora};
      UI.showToast(`${nombre} actualizado`,'success');
    } else {
      catalogo.push({
        id:`cat-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
        nombre,categoria,unidad,paqueteMinimo:paquete,notas,activo,actualizadoEn:ahora,
      });
      UI.showToast(`${nombre} añadido al catálogo`,'success');
    }

    await App.setState('catalogo', catalogo);
    _renderList();
  }

  // ── Utils ────────────────────────────────────────────────────────

  function _getCategoriasUsadas(catalogo) {
    const usadas = [...new Set(catalogo.map(a=>a.categoria))];
    return usadas.sort((a,b)=>{
      const ia=CATEGORIAS_ORDEN.indexOf(a), ib=CATEGORIAS_ORDEN.indexOf(b);
      if(ia===-1&&ib===-1) return a.localeCompare(b,'es');
      if(ia===-1) return 1; if(ib===-1) return -1;
      return ia-ib;
    });
  }

  function _ensureView() {
    if (!document.getElementById('view-articulos')) {
      const v=document.createElement('div');
      v.id='view-articulos'; v.className='view';
      document.getElementById('app-content')?.appendChild(v);
    }
  }

  return { render, openForm, getCatalogo, findByNombre };

})();
