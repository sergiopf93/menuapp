/**
 * MenuApp — Módulo de Inventario (Fase 1 — stub)
 * Muestra un placeholder hasta que se desarrolle la Fase 1.
 * @module Inventario
 */

const Inventario = (() => {

  function render() {
    _ensureView();
    const state = App.getState();
    const { inventario } = state;

    const view = document.getElementById('view-inventario');
    if (!view) return;

    view.innerHTML = `
      <div class="flex justify-between items-center mb-4">
        <h1 class="font-bold" style="font-size:var(--font-size-xl)">Despensa</h1>
        <button class="btn btn-primary btn-sm" onclick="Inventario.openAddForm()">+ Añadir</button>
      </div>
      ${!inventario || inventario.length === 0
        ? `<div class="empty-state">
             <div class="empty-state-icon">🥕</div>
             <h2 class="empty-state-title">Despensa vacía</h2>
             <p class="empty-state-desc">Añade artículos para que el generador de menús pueda usarlos.</p>
             <button class="btn btn-primary" onclick="Inventario.openAddForm()">Añadir primer artículo</button>
           </div>`
        : _renderList(inventario)
      }
    `;
  }

  function _renderList(items) {
    const groups = { congelador: [], nevera: [], exterior: [] };
    items.forEach(item => groups[item.ubicacion]?.push(item));

    const labels = { congelador: '🧊 Congelador', nevera: '❄️ Nevera', exterior: '🏠 Despensa exterior' };

    return Object.entries(groups)
      .filter(([, list]) => list.length > 0)
      .map(([key, list]) => `
        <div class="dashboard-section">
          <h2 class="section-title">${labels[key]}</h2>
          ${list.map(item => _renderItem(item)).join('')}
        </div>
      `).join('');
  }

  function _renderItem(item) {
    const status = Dates.expiryStatus(item.fechaCaducidad);
    const badgeMap = {
      expired: '<span class="badge badge-red">Caducado</span>',
      urgent:  '<span class="badge badge-orange">Caduca pronto</span>',
      soon:    '<span class="badge badge-orange">Esta semana</span>',
    };

    return `
      <div class="list-item">
        <div class="list-item-content">
          <div class="list-item-title">${UI.escapeHtml(item.nombre)}</div>
          <div class="list-item-subtitle">
            ${item.cantidad} ${item.unidad} · ${item.categoria}
            ${badgeMap[status] || ''}
          </div>
        </div>
        <div class="list-item-actions">
          <button class="btn btn-secondary btn-sm" onclick="Inventario.edit('${item.id}')">✏️</button>
          <button class="btn btn-danger btn-sm" onclick="Inventario.delete('${item.id}')">🗑</button>
        </div>
      </div>
    `;
  }

  function _ensureView() {
    if (!document.getElementById('view-inventario')) {
      const view = document.createElement('div');
      view.id = 'view-inventario';
      view.className = 'view';
      document.getElementById('app-content').appendChild(view);
    }
  }

  function openAddForm() {
    const formHtml = `
      <div class="form-group">
        <label class="form-label">Nombre <span class="required">*</span></label>
        <input class="form-control" id="inv-nombre" placeholder="Ej: Lubina, Leche entera..." />
      </div>
      <div class="form-group">
        <label class="form-label">Categoría <span class="required">*</span></label>
        <input class="form-control" id="inv-categoria" placeholder="Ej: Pescadería, Lácteos..." />
      </div>
      <div class="form-group">
        <label class="form-label">Ubicación <span class="required">*</span></label>
        <select class="form-control" id="inv-ubicacion">
          <option value="exterior">Despensa exterior</option>
          <option value="nevera">Nevera</option>
          <option value="congelador">Congelador</option>
        </select>
      </div>
      <div style="display:flex;gap:var(--space-3)">
        <div class="form-group" style="flex:2">
          <label class="form-label">Cantidad <span class="required">*</span></label>
          <input class="form-control" id="inv-cantidad" type="number" min="0" step="0.1" value="1" />
        </div>
        <div class="form-group" style="flex:1">
          <label class="form-label">Unidad</label>
          <select class="form-control" id="inv-unidad">
            <option>UN</option><option>KG</option><option>GR</option>
            <option>L</option><option>ML</option><option>PAQ</option>
          </select>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Fecha caducidad</label>
        <input class="form-control" id="inv-caducidad" type="date" />
      </div>
      <div class="form-group">
        <label class="form-label">Fecha preferencia de uso</label>
        <input class="form-control" id="inv-preferencia" type="date" />
        <p class="form-hint">El generador priorizará este artículo antes de esta fecha.</p>
      </div>
      <div class="form-group">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
          <input type="checkbox" id="inv-notif" />
          <span class="form-label" style="margin:0">Notificar el día anterior para sacar/preparar</span>
        </label>
      </div>
      <div class="form-group">
        <label class="form-label">Notas</label>
        <textarea class="form-control" id="inv-notas" rows="2" placeholder="Ej: Comprado el lunes, para receta X..."></textarea>
      </div>
    `;

    const container = document.createElement('div');
    container.innerHTML = formHtml;

    UI.showModal({
      title: 'Añadir artículo',
      content: container,
      buttons: [
        { label: 'Cancelar', type: 'secondary' },
        { label: 'Guardar',  type: 'primary', onClick: _saveNewItem },
      ],
    });
  }

  async function _saveNewItem() {
    const nombre     = document.getElementById('inv-nombre')?.value.trim();
    const categoria  = document.getElementById('inv-categoria')?.value.trim();
    const ubicacion  = document.getElementById('inv-ubicacion')?.value;
    const cantidad   = parseFloat(document.getElementById('inv-cantidad')?.value);
    const unidad     = document.getElementById('inv-unidad')?.value;
    const caducidad  = document.getElementById('inv-caducidad')?.value;
    const preferencia= document.getElementById('inv-preferencia')?.value;
    const notif      = document.getElementById('inv-notif')?.checked;
    const notas      = document.getElementById('inv-notas')?.value.trim();

    if (!nombre || !categoria || !ubicacion || isNaN(cantidad)) {
      UI.showToast('Rellena los campos obligatorios', 'error');
      return;
    }

    const nuevo = {
      id: `art-${Date.now()}`,
      nombre, categoria, ubicacion, cantidad, unidad,
      fechaCaducidad:       caducidad   || null,
      fechaPreferenciaUso:  preferencia || null,
      notificacionPreviaUso: notif,
      horasNotificacionPrevia: 24,
      notas: notas || null,
      actualizadoEn: new Date().toISOString(),
    };

    const state = App.getState();
    const inventario = [...(state.inventario || []), nuevo];
    await App.setState('inventario', inventario);

    UI.showToast(`${nombre} añadido a la despensa`, 'success');
    render();
  }

  async function edit(id) {
    const state = App.getState();
    const item = state.inventario?.find(i => i.id === id);
    if (!item) return;
    UI.showToast('Edición disponible en Fase 1', 'info');
  }

  async function delete_(id) {
    const ok = await UI.confirm('¿Eliminar este artículo de la despensa?', 'Eliminar');
    if (!ok) return;

    const state = App.getState();
    const inventario = (state.inventario || []).filter(i => i.id !== id);
    await App.setState('inventario', inventario);
    UI.showToast('Artículo eliminado', 'success');
    render();
  }

  return { render, openAddForm, edit, delete: delete_ };

})();
