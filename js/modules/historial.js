/**
 * MenuApp — Módulo de Historial de Menús (Fase 5)
 *
 * Muestra todos los menús guardados en Drive ordenados por fecha.
 * Permite ver el detalle de cada semana.
 *
 * @module Historial
 */

const Historial = (() => {

  let _menus = [];
  let _cargando = false;

  function render() {
    _ensureView();
    const view = document.getElementById('view-historial');
    if (!view) return;
    view.innerHTML = `
      <div class="module-header">
        <h1 class="module-title">Historial</h1>
      </div>
      <div id="hist-content">
        <div class="loading-container" style="padding:var(--space-12) 0">
          <div class="loading-spinner"></div>
          <p class="loading-message">Cargando historial...</p>
        </div>
      </div>`;
    _cargar();
  }

  async function _cargar() {
    if (_cargando) return;
    _cargando = true;
    try {
      const archivos = await Drive.listMenuFiles();
      _menus = [];
      for (const f of archivos) {
        try {
          const m = await Drive.readMenuJson(f.id);
          if (m) _menus.push({ ...m, _fileId: f.id });
        } catch { /* continúa */ }
      }
      _menus.sort((a, b) => b.fechaInicio.localeCompare(a.fechaInicio));
      _renderLista();
    } catch (err) {
      document.getElementById('hist-content').innerHTML =
        `<p class="text-sm text-muted">Error cargando historial: ${err.message}</p>`;
    } finally {
      _cargando = false;
    }
  }

  function _renderLista() {
    const container = document.getElementById('hist-content');
    if (!container) return;

    if (_menus.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📋</div>
          <h2 class="empty-state-title">Sin historial</h2>
          <p class="empty-state-desc">Los menús confirmados aparecerán aquí.</p>
        </div>`;
      return;
    }

    container.innerHTML = _menus.map(m => {
      const estaActivo = m.fechaInicio <= Dates.today() && m.fechaFin >= Dates.today();
      const numPlatos = _contarPlatos(m);
      return `
        <div class="cfg-item-card hist-menu-card" data-id="${m.id}" style="cursor:pointer">
          <div class="cfg-item-info">
            <div style="display:flex;align-items:center;gap:var(--space-2)">
              <span class="cfg-item-nombre">
                Semana del ${Dates.format(m.fechaInicio,'short')} al ${Dates.format(m.fechaFin,'short')}
              </span>
              ${estaActivo ? '<span class="badge badge-green">Activa</span>' : ''}
              ${m.estado==='borrador' ? '<span class="badge badge-orange">Borrador</span>' : ''}
            </div>
            <span class="text-xs text-muted">${numPlatos} platos · Generado ${_formatFechaRelativa(m.generadoEn)}</span>
          </div>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18" style="flex-shrink:0;color:var(--color-text-muted)">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </div>`;
    }).join('');

    container.querySelectorAll('.hist-menu-card').forEach(card => {
      card.addEventListener('click', () => {
        const menu = _menus.find(m => m.id === card.dataset.id);
        if (menu) _mostrarDetalle(menu);
      });
    });
  }

  function _mostrarDetalle(menu) {
    const config = App.getState().config || {};
    const tieneBebe = (config.personas || []).some(p => p.tipo === 'bebe');

    // Reutiliza la función de tabla del módulo de Menú
    const tablaHtml = _buildTablaHistorial(menu, tieneBebe);

    const container = document.createElement('div');
    container.innerHTML = tablaHtml;

    UI.showModal({
      title: `Semana del ${Dates.format(menu.fechaInicio,'long')}`,
      content: container,
    });
  }

  function _buildTablaHistorial(menu, tieneBebe) {
    const dias = menu.dias || [];
    const bloques = [
      { momento:'comida', perfil:'mayores', label:'🍽 Comida · Adultos' },
      ...(tieneBebe ? [{ momento:'comida', perfil:'bebe', label:'👶 Comida · Bebé' }] : []),
      { momento:'cena', perfil:'mayores', label:'🌙 Cena · Adultos' },
      ...(tieneBebe ? [{ momento:'cena', perfil:'bebe', label:'👶 Cena · Bebé' }] : []),
    ];

    return `
      <div style="overflow-x:auto">
        <table class="menu-tabla" style="min-width:400px">
          <thead>
            <tr>
              <th class="menu-th-momento"></th>
              ${dias.map(d=>`
                <th class="menu-th-dia">
                  <span class="menu-th-nombre">${d.diaSemana.substring(0,3)}</span>
                  <span class="menu-th-num">${Dates.fromISO(d.fecha).getDate()}</span>
                </th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${bloques.map(b => {
              let html = `<tr class="menu-tr-label"><td colspan="${dias.length+1}">${b.label}</td></tr>`;
              html += `<tr>`;
              html += `<td class="menu-td-rowlabel"></td>`;
              dias.forEach(d => {
                const bloque = d[b.momento];
                if (!bloque?.activo) { html+=`<td class="menu-td menu-td-especial">—</td>`; return; }
                const platos = b.perfil==='bebe' ? bloque?.platosBebe : bloque?.platosMayores;
                const nombres = (platos||[]).map(p=>UI.escapeHtml(p.nombre)).join(' + ');
                html += `<td class="menu-td">${nombres||'–'}</td>`;
              });
              html += `</tr>`;
              return html;
            }).join('')}
          </tbody>
        </table>
      </div>`;
  }

  function _contarPlatos(menu) {
    const ids = new Set();
    (menu.dias||[]).forEach(d=>{
      ['comida','cena'].forEach(m=>{
        [...(d[m]?.platosMayores||[]),...(d[m]?.platosBebe||[])].forEach(p=>ids.add(p.id));
      });
    });
    return ids.size;
  }

  function _formatFechaRelativa(isoString) {
    if (!isoString) return '';
    const dias = -Dates.daysUntil(isoString.substring(0,10));
    if (dias === 0) return 'hoy';
    if (dias === 1) return 'ayer';
    if (dias < 7)  return `hace ${dias} días`;
    return Dates.format(isoString.substring(0,10));
  }

  function _ensureView() {
    if (!document.getElementById('view-historial')) {
      const v=document.createElement('div');
      v.id='view-historial';v.className='view';
      document.getElementById('app-content')?.appendChild(v);
    }
  }

  return { render };

})();
