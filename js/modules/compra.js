/** MenuApp — Módulo Compra (stub Fase 4) */
const Compra = (() => {
  function render() {
    _ensureView();
    const view = document.getElementById('view-compra');
    if (view) view.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🛒</div><h2 class="empty-state-title">Lista de la compra</h2><p class="empty-state-desc">Disponible en la Fase 4. Confirma un menú primero.</p></div>`;
  }
  function _ensureView() {
    if (!document.getElementById('view-compra')) {
      const v = document.createElement('div');
      v.id = 'view-compra'; v.className = 'view';
      document.getElementById('app-content').appendChild(v);
    }
  }
  return { render };
})();
