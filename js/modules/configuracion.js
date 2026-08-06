/** MenuApp — Módulo Configuración (stub Fase 5) */
const Configuracion = (() => {
  function render() {
    _ensureView();
    const view = document.getElementById('view-config');
    const state = App.getState();
    const config = state.config;
    if (!view) return;

    const personas = config?.personas || [];
    const supermercados = config?.supermercados || [];

    view.innerHTML = `
      <h1 class="font-bold mb-4" style="font-size:var(--font-size-xl)">Configuración</h1>

      <div class="dashboard-section">
        <h2 class="section-title">Familia</h2>
        <div class="card">
          ${personas.map(p => `
            <div class="list-item" style="margin-bottom:var(--space-2)">
              <div class="list-item-content">
                <div class="list-item-title">${UI.escapeHtml(p.nombre)}</div>
                <div class="list-item-subtitle">${p.tipo === 'bebe' ? '👶 Bebé' : '🧑 Adulto'}</div>
              </div>
            </div>
          `).join('')}
          <p class="text-sm text-muted mt-2">Edición de personas disponible en Fase 5.</p>
        </div>
      </div>

      <div class="dashboard-section">
        <h2 class="section-title">Supermercados</h2>
        ${supermercados.map(s => `
          <div class="card">
            <p class="font-bold">${UI.escapeHtml(s.nombre)}</p>
            <p class="text-sm text-muted">${s.secciones.length} secciones configuradas</p>
          </div>
        `).join('')}
        <p class="text-sm text-muted">Edición de supermercados disponible en Fase 5.</p>
      </div>

      <div class="dashboard-section">
        <h2 class="section-title">Cuenta</h2>
        <div class="card">
          <button class="btn btn-danger btn-full" onclick="App.getState()">
            Cerrar sesión
          </button>
        </div>
      </div>
    `;
  }
  function _ensureView() {
    if (!document.getElementById('view-config')) {
      const v = document.createElement('div');
      v.id = 'view-config'; v.className = 'view';
      document.getElementById('app-content').appendChild(v);
    }
  }
  return { render };
})();
