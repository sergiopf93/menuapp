/**
 * MenuApp — Módulo de Inventario (Fase 1 — completo)
 * Gestión completa de despensa: exterior, nevera y congelador.
 *
 * Funcionalidades:
 * - Listado por ubicación con filtros y búsqueda
 * - Alta, edición y baja de artículos
 * - Ajuste rápido de cantidad (+/-)
 * - Indicadores visuales de caducidad
 * - Forzar uso en el generador de menú
 *
 * @module Inventario
 */

const Inventario = (() => {

  let _filtroTexto   = '';
  let _filtroUbic    = 'todas';

  const CATEGORIAS = [
    'Carnicería','Pescadería','Frutas y verduras','Lácteos',
    'Huevos','Charcutería','Panadería','Congelados',
    'Envasados','Pasta, arroz y legumbres','Conservas',
    'Aceites y condimentos','Bebidas','Droguería','Otros',
  ];

  const UNIDADES = ['UN','KG','GR','L','ML','PAQ','BOT','LT'];

  const UBICACIONES = {
    todas:     { label:'Todas',    icon:'📦' },
    exterior:  { label:'Despensa', icon:'🏠' },
    nevera:    { label:'Nevera',   icon:'❄️' },
    congelador:{ label:'Congelador',icon:'🧊' },
  };

  // ── API pública ──────────────────────────────────────────────────

  function render() {
    _ensureView();
    const view = document.getElementById('view-inventario');
    if (!view) return;
    view.innerHTML = _buildShell();
    _bindShellEvents();
    _renderList();
  }

  // ── Shell ────────────────────────────────────────────────────────

  function _buildShell() {
    return `
      <div class="module-header">
        <h1 class="module-title">Despensa</h1>
        <button class="btn btn-primary btn-sm" id="inv-btn-add">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="16" height="16">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          Añadir
        </button>
      </div>

      <div class="inv-ubicacion-tabs" id="inv-ubicacion-tabs">
        ${Object.entries(UBICACIONES).map(([key,val]) => `
          <button class="inv-tab ${_filtroUbic===key?'active':''}" data-ubic="${key}">
            <span>${val.icon}</span><span>${val.label}</span>
          </button>
        `).join('')}
      </div>

      <div class="search-bar" style="margin-bottom:var(--space-4)">
        <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
        </svg>
        <input type="search" id="inv-search" placeholder="Buscar artículo..."
               value="${UI.escapeHtml(_filtroTexto)}" autocomplete="off"/>
      </div>

      <div id="inv-summary"></div>
      <div id="inv-list"></div>
    `;
  }

  function _bindShellEvents() {
    document.getElementById('inv-btn-add')?.addEventListener('click', () => openForm());

    document.getElementById('inv-ubicacion-tabs')?.addEventListener('click', (e) => {
      const btn = e.target.closest('.inv-tab');
      if (!btn) return;
      _filtroUbic = btn.dataset.ubic;
      document.querySelectorAll('.inv-tab').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      _renderList();
    });

    let searchTimer;
    document.getElementById('inv-search')?.addEventListener('input', (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        _filtroTexto = e.target.value.trim().toLowerCase();
        _renderList();
      }, 250);
    });
  }

  // ── Lista ────────────────────────────────────────────────────────

  function _renderList() {
    const container = document.getElementById('inv-list');
    const summary   = document.getElementById('inv-summary');
    if (!container) return;

    const { inventario } = App.getState();
    const items = inventario || [];

    const filtered = items.filter(item => {
      const matchUbic = _filtroUbic === 'todas' || item.ubicacion === _filtroUbic;
      const matchText = !_filtroTexto ||
        item.nombre.toLowerCase().includes(_filtroTexto) ||
        item.categoria.toLowerCase().includes(_filtroTexto);
      return matchUbic && matchText;
    });

    if (summary) summary.innerHTML = _buildSummary(items);

    if (filtered.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">${_filtroUbic==='congelador'?'🧊':_filtroUbic==='nevera'?'❄️':'🥕'}</div>
          <h2 class="empty-state-title">${_filtroTexto?'Sin resultados':'Sin artículos'}</h2>
          <p class="empty-state-desc">
            ${_filtroTexto
              ?`No se encontró "${UI.escapeHtml(_filtroTexto)}" en la despensa.`
              :'Añade artículos para que el generador de menús pueda usarlos.'}
          </p>
          ${!_filtroTexto?`<button class="btn btn-primary" id="inv-empty-add">Añadir primer artículo</button>`:''}
        </div>`;
      document.getElementById('inv-empty-add')?.addEventListener('click', () => openForm());
      return;
    }

    if (_filtroUbic === 'todas') {
      const groups = { congelador:[], nevera:[], exterior:[] };
      filtered.forEach(item => groups[item.ubicacion]?.push(item));
      container.innerHTML = Object.entries(groups)
        .filter(([,list]) => list.length > 0)
        .map(([key,list]) => `
          <div class="inv-group">
            <h2 class="section-title">
              ${UBICACIONES[key].icon} ${UBICACIONES[key].label}
              <span class="badge badge-gray" style="margin-left:6px">${list.length}</span>
            </h2>
            ${list.sort(_sortByUrgency).map(_buildItemCard).join('')}
          </div>`).join('');
    } else {
      container.innerHTML = filtered.sort(_sortByUrgency).map(_buildItemCard).join('');
    }

    _bindItemEvents(container);
  }

  function _buildSummary(all) {
    const caducados = all.filter(i => Dates.expiryStatus(i.fechaCaducidad)==='expired').length;
    const urgentes  = all.filter(i => Dates.expiryStatus(i.fechaCaducidad)==='urgent').length;
    const forzados  = all.filter(i => i.forzarUso).length;
    if (!caducados && !urgentes && !forzados) return '';
    return `<div class="inv-summary-bar">
      ${caducados?`<span class="badge badge-red">⚠ ${caducados} caducado${caducados>1?'s':''}</span>`:''}
      ${urgentes ?`<span class="badge badge-orange">🕐 ${urgentes} caduca pronto</span>`:''}
      ${forzados ?`<span class="badge badge-blue">⭐ ${forzados} forzado${forzados>1?'s':''}</span>`:''}
    </div>`;
  }

  function _buildItemCard(item) {
    const status = Dates.expiryStatus(item.fechaCaducidad);
    const daysLeft = item.fechaCaducidad ? Dates.daysUntil(item.fechaCaducidad) : null;
    const expiryBadge = {
      expired:`<span class="badge badge-red">Caducado</span>`,
      urgent: `<span class="badge badge-orange">Caduca en ${daysLeft}d</span>`,
      soon:   `<span class="badge badge-orange">Esta semana</span>`,
    }[status]||'';

    const cardClass = ['inv-card',
      status==='expired'?'inv-card--expired':'',
      status==='urgent'?'inv-card--urgent':'',
      item.forzarUso?'inv-card--forced':'',
    ].filter(Boolean).join(' ');

    return `
      <div class="${cardClass}" data-id="${item.id}">
        <div class="inv-card-main">
          <div class="inv-card-info">
            <div class="inv-card-name">${UI.escapeHtml(item.nombre)}</div>
            <div class="inv-card-meta">
              <span class="inv-card-categoria">${UI.escapeHtml(item.categoria)}</span>
              ${expiryBadge}
              ${item.forzarUso?'<span class="badge badge-blue">⭐ Usar esta semana</span>':''}
            </div>
            ${item.notas?`<div class="inv-card-notas">${UI.escapeHtml(item.notas)}</div>`:''}
          </div>
          <div class="inv-qty-control">
            <button class="inv-qty-btn inv-qty-minus" data-id="${item.id}">−</button>
            <div class="inv-qty-display">
              <span class="inv-qty-value">${item.cantidad}</span>
              <span class="inv-qty-unit">${item.unidad}</span>
            </div>
            <button class="inv-qty-btn inv-qty-plus" data-id="${item.id}">+</button>
          </div>
        </div>
        <div class="inv-card-actions">
          <button class="inv-action-btn inv-action-force ${item.forzarUso?'active':''}" data-id="${item.id}" title="${item.forzarUso?'Quitar prioridad':'Usar esta semana'}">⭐</button>
          <button class="inv-action-btn inv-action-edit" data-id="${item.id}" title="Editar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="inv-action-btn inv-action-delete" data-id="${item.id}" title="Eliminar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
          </button>
        </div>
      </div>`;
  }

  function _bindItemEvents(container) {
    container.addEventListener('click', async (e) => {
      const id = e.target.closest('[data-id]')?.dataset.id;
      if (!id) return;
      if      (e.target.closest('.inv-qty-plus'))    await _adjustQty(id,+1);
      else if (e.target.closest('.inv-qty-minus'))   await _adjustQty(id,-1);
      else if (e.target.closest('.inv-action-edit'))  openForm(id);
      else if (e.target.closest('.inv-action-delete'))await _deleteItem(id);
      else if (e.target.closest('.inv-action-force')) await _toggleForzar(id);
    });
  }

  // ── Cantidad ─────────────────────────────────────────────────────

  async function _adjustQty(id, delta) {
    const state = App.getState();
    const inventario = [...(state.inventario||[])];
    const idx = inventario.findIndex(i => i.id===id);
    if (idx===-1) return;
    const item = {...inventario[idx]};
    const nueva = Math.max(0, item.cantidad+delta);
    if (nueva===item.cantidad) return;
    item.cantidad = nueva;
    item.actualizadoEn = new Date().toISOString();
    inventario[idx] = item;
    const card = document.querySelector(`.inv-card[data-id="${id}"] .inv-qty-value`);
    if (card) card.textContent = nueva;
    await App.setState('inventario', inventario);
  }

  // ── Forzar uso ───────────────────────────────────────────────────

  async function _toggleForzar(id) {
    const state = App.getState();
    const inventario = [...(state.inventario||[])];
    const idx = inventario.findIndex(i => i.id===id);
    if (idx===-1) return;
    const item = {...inventario[idx]};
    item.forzarUso = !item.forzarUso;
    item.actualizadoEn = new Date().toISOString();
    inventario[idx] = item;
    await App.setState('inventario', inventario);
    UI.showToast(item.forzarUso?`${item.nombre} se usará en el próximo menú`:`${item.nombre} sin prioridad`,'info');
    _renderList();
  }

  // ── Eliminar ─────────────────────────────────────────────────────

  async function _deleteItem(id) {
    const state = App.getState();
    const item = (state.inventario||[]).find(i => i.id===id);
    if (!item) return;
    const ok = await UI.confirm(`¿Eliminar <strong>${UI.escapeHtml(item.nombre)}</strong> de la despensa?`,'Eliminar');
    if (!ok) return;
    const inventario = (state.inventario||[]).filter(i => i.id!==id);
    await App.setState('inventario', inventario);
    UI.showToast(`${item.nombre} eliminado`,'success');
    _renderList();
  }

  // ── Formulario ───────────────────────────────────────────────────

  function openForm(id=null) {
    const state = App.getState();
    const item = id?(state.inventario||[]).find(i=>i.id===id):null;
    const container = document.createElement('div');
    container.innerHTML = _buildForm(item);
    _initFormEvents();
    UI.showModal({
      title: item?`Editar — ${item.nombre}`:'Añadir artículo',
      content: container,
      buttons:[
        {label:'Cancelar',type:'secondary'},
        {label:item?'Guardar cambios':'Añadir',type:'primary',onClick:()=>_submitForm(item)},
      ],
    });
    setTimeout(()=>_initFormEvents(),100);
  }

  function _buildForm(item) {
    const today = Dates.today();
    return `
      <div class="form-group">
        <label class="form-label" for="inv-f-nombre">Nombre <span class="required">*</span></label>
        <input class="form-control" id="inv-f-nombre" type="text"
               value="${UI.escapeHtml(item?.nombre||'')}" placeholder="Ej: Lubina, Leche, Garbanzos..." autocomplete="off"/>
      </div>
      <div class="form-group">
        <label class="form-label" for="inv-f-categoria">Categoría <span class="required">*</span></label>
        <div style="position:relative">
          <input class="form-control" id="inv-f-categoria" type="text"
                 value="${UI.escapeHtml(item?.categoria||'')}" placeholder="Ej: Pescadería, Lácteos..." autocomplete="off"/>
          <div id="inv-cat-sugg" class="categoria-suggestions hidden"></div>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label" for="inv-f-ubicacion">Ubicación <span class="required">*</span></label>
        <select class="form-control" id="inv-f-ubicacion">
          <option value="exterior"   ${item?.ubicacion==='exterior'   ?'selected':''}>🏠 Despensa exterior</option>
          <option value="nevera"     ${item?.ubicacion==='nevera'     ?'selected':''}>❄️ Nevera</option>
          <option value="congelador" ${item?.ubicacion==='congelador' ?'selected':''}>🧊 Congelador</option>
        </select>
      </div>
      <div style="display:flex;gap:var(--space-3)">
        <div class="form-group" style="flex:2">
          <label class="form-label" for="inv-f-cantidad">Cantidad <span class="required">*</span></label>
          <input class="form-control" id="inv-f-cantidad" type="number" min="0" step="0.1" value="${item?.cantidad??1}"/>
        </div>
        <div class="form-group" style="flex:1">
          <label class="form-label" for="inv-f-unidad">Unidad</label>
          <select class="form-control" id="inv-f-unidad">
            ${UNIDADES.map(u=>`<option ${item?.unidad===u?'selected':''}>${u}</option>`).join('')}
          </select>
        </div>
      </div>
      <div style="display:flex;gap:var(--space-3)">
        <div class="form-group" style="flex:1">
          <label class="form-label" for="inv-f-caducidad">Fecha caducidad</label>
          <input class="form-control" id="inv-f-caducidad" type="date" value="${item?.fechaCaducidad||''}" min="${today}"/>
        </div>
        <div class="form-group" style="flex:1">
          <label class="form-label" for="inv-f-preferencia">Usar antes de</label>
          <input class="form-control" id="inv-f-preferencia" type="date" value="${item?.fechaPreferenciaUso||''}" min="${today}"/>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label" for="inv-f-paquete">Unidades mínimas de compra</label>
        <input class="form-control" id="inv-f-paquete" type="number" min="1" step="1" value="${item?.paqueteMinimo??1}"/>
        <p class="form-hint">Cuántas unidades se compran juntas (ej: 6 huevos, 1 brik leche).</p>
      </div>
      <div class="form-group">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
          <input type="checkbox" id="inv-f-notif" ${item?.notificacionPreviaUso?'checked':''}/>
          <span class="form-label" style="margin:0">Notificar el día anterior para sacar o preparar</span>
        </label>
      </div>
      <div class="form-group" id="inv-f-horas-w" style="${item?.notificacionPreviaUso?'':'display:none'}">
        <label class="form-label" for="inv-f-horas">Horas de antelación</label>
        <input class="form-control" id="inv-f-horas" type="number" min="1" max="72" value="${item?.horasNotificacionPrevia??24}"/>
      </div>
      <div class="form-group">
        <label class="form-label" for="inv-f-notas">Notas</label>
        <textarea class="form-control" id="inv-f-notas" rows="2" placeholder="Ej: Comprado el lunes...">${UI.escapeHtml(item?.notas||'')}</textarea>
      </div>`;
  }

  function _initFormEvents() {
    const notifCb = document.getElementById('inv-f-notif');
    const horasW  = document.getElementById('inv-f-horas-w');
    notifCb?.addEventListener('change',()=>{ if(horasW) horasW.style.display=notifCb.checked?'':'none'; });

    const catInput = document.getElementById('inv-f-categoria');
    const catSugg  = document.getElementById('inv-cat-sugg');
    if (!catInput||!catSugg) return;
    catInput.addEventListener('input',()=>{
      const val = catInput.value.toLowerCase();
      if (!val) { catSugg.classList.add('hidden'); return; }
      const matches = CATEGORIAS.filter(c=>c.toLowerCase().includes(val));
      if (!matches.length) { catSugg.classList.add('hidden'); return; }
      catSugg.innerHTML = matches.map(c=>`<div class="categoria-option" data-v="${UI.escapeHtml(c)}">${UI.escapeHtml(c)}</div>`).join('');
      catSugg.classList.remove('hidden');
      catSugg.querySelectorAll('.categoria-option').forEach(o=>{
        o.addEventListener('click',()=>{ catInput.value=o.dataset.v; catSugg.classList.add('hidden'); });
      });
    });
    document.addEventListener('click',(e)=>{ if(!catInput.contains(e.target)) catSugg.classList.add('hidden'); });
  }

  async function _submitForm(itemOriginal) {
    const nombre    = document.getElementById('inv-f-nombre')?.value.trim();
    const categoria = document.getElementById('inv-f-categoria')?.value.trim();
    const ubicacion = document.getElementById('inv-f-ubicacion')?.value;
    const cantidad  = parseFloat(document.getElementById('inv-f-cantidad')?.value);
    const unidad    = document.getElementById('inv-f-unidad')?.value;
    const caducidad = document.getElementById('inv-f-caducidad')?.value||null;
    const preferencia=document.getElementById('inv-f-preferencia')?.value||null;
    const paquete   = parseInt(document.getElementById('inv-f-paquete')?.value)||1;
    const notif     = document.getElementById('inv-f-notif')?.checked||false;
    const horas     = parseInt(document.getElementById('inv-f-horas')?.value)||24;
    const notas     = document.getElementById('inv-f-notas')?.value.trim()||null;

    if (!nombre)             { UI.showToast('El nombre es obligatorio','error'); return; }
    if (!categoria)          { UI.showToast('La categoría es obligatoria','error'); return; }
    if (isNaN(cantidad)||cantidad<0){ UI.showToast('Cantidad no válida','error'); return; }

    const state = App.getState();
    const inventario = [...(state.inventario||[])];
    const ahora = new Date().toISOString();

    if (itemOriginal) {
      const idx = inventario.findIndex(i=>i.id===itemOriginal.id);
      if (idx===-1) return;
      inventario[idx]={...inventario[idx],nombre,categoria,ubicacion,cantidad,unidad,
        fechaCaducidad:caducidad,fechaPreferenciaUso:preferencia,paqueteMinimo:paquete,
        notificacionPreviaUso:notif,horasNotificacionPrevia:horas,notas,actualizadoEn:ahora};
      UI.showToast(`${nombre} actualizado`,'success');
    } else {
      inventario.push({
        id:`art-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
        nombre,categoria,ubicacion,cantidad,unidad,
        fechaCaducidad:caducidad,fechaPreferenciaUso:preferencia,paqueteMinimo:paquete,
        notificacionPreviaUso:notif,horasNotificacionPrevia:horas,notas,
        forzarUso:false,actualizadoEn:ahora,
      });
      UI.showToast(`${nombre} añadido a la despensa`,'success');
    }

    await App.setState('inventario', inventario);
    _renderList();
  }

  // ── Utils ────────────────────────────────────────────────────────

  function _sortByUrgency(a,b){
    const o={expired:0,urgent:1,soon:2,ok:3,none:4};
    const sa=o[Dates.expiryStatus(a.fechaCaducidad)]??4;
    const sb=o[Dates.expiryStatus(b.fechaCaducidad)]??4;
    if(sa!==sb) return sa-sb;
    return a.nombre.localeCompare(b.nombre,'es');
  }

  function _ensureView(){
    if(!document.getElementById('view-inventario')){
      const v=document.createElement('div');
      v.id='view-inventario';v.className='view';
      document.getElementById('app-content')?.appendChild(v);
    }
  }

  return { render, openForm };

})();
