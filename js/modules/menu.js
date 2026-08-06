/** MenuApp — Módulo Menú (stub Fase 3) */
const Menu = (() => {
  function render() {
    _ensureView();
    const view = document.getElementById('view-menu');
    if (!view) return;
    view.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📅</div>
        <h2 class="empty-state-title">Generador de menú</h2>
        <p class="empty-state-desc">Disponible en la Fase 3 del desarrollo.</p>
        <p class="text-sm text-muted">Primero añade artículos a la despensa (Fase 1) y platos al catálogo (Fase 2).</p>
      </div>
    `;
  }
  function _ensureView() {
    if (!document.getElementById('view-menu')) {
      const view = document.createElement('div');
      view.id = 'view-menu';
      view.className = 'view';
      document.getElementById('app-content').appendChild(view);
    }
  }
  return { render };
})();
