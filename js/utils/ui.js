/**
 * MenuApp — Utilidades de interfaz de usuario
 * Toast, modales, loading screen, navegación entre vistas.
 *
 * @module UI
 */

const UI = (() => {

  let _toastTimer = null;

  // ── Toast ────────────────────────────────────────────────────────

  /**
   * Muestra un mensaje de notificación temporal en la parte inferior de la pantalla.
   * @param {string} message
   * @param {'info'|'success'|'error'|'warning'} [type='info']
   * @param {number} [duration=3000] - Milisegundos de visibilidad
   */
  function showToast(message, type = 'info', duration = 3000) {
    const toast = document.getElementById('toast');
    if (!toast) return;

    toast.textContent = message;
    toast.className   = `toast ${type} show`;

    if (_toastTimer) clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => {
      toast.className = 'toast';
    }, duration);
  }

  // ── Screens ──────────────────────────────────────────────────────

  /**
   * Muestra una pantalla y oculta las demás.
   * @param {'login'|'loading'|'app'} screenId
   */
  function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
    const target = document.getElementById(`screen-${screenId}`);
    if (target) target.classList.add('active');
  }

  /**
   * Actualiza el mensaje de la pantalla de carga.
   * @param {string} message
   */
  function setLoadingMessage(message) {
    const el = document.getElementById('loading-message');
    if (el) el.textContent = message;
  }

  // ── Modal ────────────────────────────────────────────────────────

  /**
   * Muestra un modal genérico.
   * @param {{ title: string, content: string|HTMLElement, buttons: Array }} options
   * @returns {{ close: Function }} - Objeto con método close()
   */
  function showModal({ title, content, buttons = [] }) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'modal-title');

    // Header
    const header = document.createElement('div');
    header.className = 'modal-header';

    const titleEl = document.createElement('h2');
    titleEl.id = 'modal-title';
    titleEl.className = 'modal-title';
    titleEl.textContent = title;

    const closeBtn = document.createElement('button');
    closeBtn.className = 'modal-close';
    closeBtn.setAttribute('aria-label', 'Cerrar');
    closeBtn.innerHTML = '&times;';
    closeBtn.onclick = close;

    header.appendChild(titleEl);
    header.appendChild(closeBtn);

    // Body
    const body = document.createElement('div');
    body.className = 'modal-body';
    if (typeof content === 'string') {
      body.innerHTML = content;
    } else {
      body.appendChild(content);
    }

    // Footer con botones
    let footer = null;
    if (buttons.length > 0) {
      footer = document.createElement('div');
      footer.className = 'modal-footer';
      buttons.forEach(({ label, type = 'secondary', onClick }) => {
        const btn = document.createElement('button');
        btn.className = `btn btn-${type}`;
        btn.textContent = label;
        btn.onclick = () => { if (onClick) onClick(); close(); };
        footer.appendChild(btn);
      });
    }

    modal.appendChild(header);
    modal.appendChild(body);
    if (footer) modal.appendChild(footer);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Cierra al pulsar fuera del modal
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });

    // Foco en el primer elemento interactivo
    const firstFocusable = modal.querySelector('button, input, select, textarea');
    if (firstFocusable) firstFocusable.focus();

    function close() {
      overlay.remove();
    }

    return { close };
  }

  /**
   * Diálogo de confirmación simple.
   * @param {string} message
   * @param {string} [confirmLabel='Confirmar']
   * @returns {Promise<boolean>}
   */
  function confirm(message, confirmLabel = 'Confirmar') {
    return new Promise((resolve) => {
      const modal = showModal({
        title: '¿Estás seguro?',
        content: `<p class="text-sm">${message}</p>`,
        buttons: [
          { label: 'Cancelar',    type: 'secondary', onClick: () => resolve(false) },
          { label: confirmLabel,  type: 'danger',    onClick: () => resolve(true) },
        ],
      });
      // Si cierra con X, considera que canceló
      modal._resolve = resolve;
    });
  }

  // ── Navigation ───────────────────────────────────────────────────

  /**
   * Activa una vista dentro del app shell.
   * Actualiza también el estado activo de la bottom nav.
   * @param {string} viewId
   */
  function activateView(viewId) {
    // Views
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    const target = document.getElementById(`view-${viewId}`);
    if (target) target.classList.add('active');

    // Bottom nav
    document.querySelectorAll('.nav-item').forEach((item) => {
      item.classList.toggle('active', item.dataset.view === viewId);
    });
  }

  // ── PWA Banner ───────────────────────────────────────────────────

  /**
   * Muestra el banner de instalación PWA en iOS si la app no está instalada.
   */
  function maybeShowPWABanner() {
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const isStandalone = window.navigator.standalone === true;
    const dismissed = localStorage.getItem('pwa_banner_dismissed');

    if (isIOS && !isStandalone && !dismissed) {
      const banner = document.getElementById('pwa-banner');
      if (banner) {
        banner.classList.remove('hidden');
        document.getElementById('pwa-banner-close')?.addEventListener('click', () => {
          banner.classList.add('hidden');
          localStorage.setItem('pwa_banner_dismissed', '1');
        });
      }
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────

  /**
   * Crea un elemento HTML con clases y contenido.
   * @param {string} tag
   * @param {string} [className]
   * @param {string} [innerHTML]
   * @returns {HTMLElement}
   */
  function createElement(tag, className, innerHTML) {
    const el = document.createElement(tag);
    if (className)  el.className = className;
    if (innerHTML)  el.innerHTML = innerHTML;
    return el;
  }

  /**
   * Escapa HTML para prevenir XSS al insertar texto de usuario en el DOM.
   * @param {string} str
   * @returns {string}
   */
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  return {
    showToast,
    showScreen,
    setLoadingMessage,
    showModal,
    confirm,
    activateView,
    maybeShowPWABanner,
    createElement,
    escapeHtml,
  };

})();
