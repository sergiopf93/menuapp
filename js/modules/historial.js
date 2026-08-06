/** MenuApp — Módulo Historial (stub Fase 6) */
const Historial = (() => {
  function render() {
    _ensureView();
    const view = document.getElementById('view-historial');
    if (view) view.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📋</div><h2 class="empty-state-title">Historial de menús</h2><p class="empty-state-desc">Aquí verás todos los menús confirmados.</p></div>`;
  }
  function _ensureView() {
    if (!document.getElementById('view-historial')) {
      const v = document.createElement('div');
      v.id = 'view-historial'; v.className = 'view';
      document.getElementById('app-content').appendChild(v);
    }
  }
  return { render };
})();
