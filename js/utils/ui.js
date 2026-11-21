/**
 * MenuApp — Utilidades de interfaz de usuario
 * Toast, modales, loading screen, navegación entre vistas.
 *
 * @module UI
 */

const UI = (() => {

  let _toastTimer = null;

  let _suggestions = null;
  let _modalClose = null;
  const _overlays = new Set();

  function viewportBounds() {
    const v = window.visualViewport;
    const top = v?.offsetTop || 0;
    const left = v?.offsetLeft || 0;
    const width = v?.width || window.innerWidth;
    const height = v?.height || window.innerHeight;
    return { top, left, width, height, bottom: top + height, right: left + width };
  }

  function hideSuggestions() {
    if (!_suggestions) return;
    _suggestions.list.classList.add('hidden');
    _suggestions.input.setAttribute('aria-expanded', 'false');
    _suggestions.input.removeAttribute('aria-activedescendant');
    _suggestions = null;
  }

  function positionSuggestions() {
    if (!_suggestions) return;
    const { input, list } = _suggestions;
    if (!input.isConnected || !list.isConnected || list.classList.contains('hidden')) {
      hideSuggestions();
      return;
    }
    const v = viewportBounds();
    const anchor = input.getBoundingClientRect();
    const owner = input.closest('.modal-body, .app-content');
    const region = owner?.getBoundingClientRect();
    let top = Math.max(v.top + 8, region?.top || v.top);
    let bottom = Math.min(v.bottom - 8, region?.bottom || v.bottom);
    // Las acciones fijas de Compra también ocupan espacio visible.
    if (owner?.classList.contains('app-content')) {
      const toolbar = owner.querySelector('.view.active .compra-acciones, .view.active .compra-modo-header');
      if (toolbar) top = Math.max(top, toolbar.getBoundingClientRect().bottom + 4);
    }
    if (anchor.bottom <= top || anchor.top >= bottom) { hideSuggestions(); return; }
    const below = Math.max(0, bottom - anchor.bottom - 4);
    const above = Math.max(0, anchor.top - top - 4);
    const up = below < Math.min(240, list.scrollHeight) && above > below;
    const height = Math.min(240, up ? above : below);
    if (height < 24) { hideSuggestions(); return; }
    const width = Math.min(Math.max(anchor.width, 220), v.width - 16);
    list.style.width = `${width}px`;
    list.style.maxHeight = `${height}px`;
    list.style.left = `${Math.max(v.left + 8, Math.min(anchor.left, v.right - width - 8))}px`;
    list.style.top = `${up ? anchor.top - Math.min(list.scrollHeight + 2, height) - 4 : anchor.bottom + 4}px`;
    list.dataset.placement = up ? 'top' : 'bottom';
  }

  /** Una lista flotante por vez, limitada al espacio visible y al panel del campo. */
  function showSuggestions(input, list) {
    if (!input.isConnected || document.activeElement !== input) { list.classList.add('hidden'); return; }
    if (_suggestions?.list !== list) hideSuggestions();
    _suggestions = { input, list };
    list.classList.add('floating-suggestions');
    list.classList.remove('hidden');
    list.setAttribute('role', 'listbox');
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-controls', list.id);
    input.setAttribute('aria-expanded', 'true');
    input.removeAttribute('aria-activedescendant');
    [...list.children].forEach((option, i) => {
      option.id = `${list.id}-option-${i}`;
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', 'false');
    });
    positionSuggestions();
  }

  /** Bloquea el fondo y restaura el foco sin desplazarlo, también al anidar una confirmación. */
  function attachOverlay(overlay, close) {
    hideSuggestions();
    const previousFocus = document.activeElement;
    const previousOverlay = [..._overlays].at(-1);
    if (previousOverlay) previousOverlay.inert = true;
    _overlays.add(overlay);
    document.body.classList.add('modal-open');
    document.getElementById('screen-app').inert = true;
    const onKey = e => {
      if ([..._overlays].at(-1) !== overlay) return;
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      if (e.key !== 'Tab') return;
      const focusable = [...overlay.querySelectorAll('input, select, textarea, button, [tabindex="0"]')]
        .filter(el => !el.disabled && el.getClientRects().length);
      if (!focusable.length) { e.preventDefault(); return; }
      const first = focusable[0], last = focusable.at(-1);
      if (!overlay.contains(document.activeElement) || (e.shiftKey && document.activeElement === first)) {
        e.preventDefault(); (e.shiftKey ? last : first).focus({ preventScroll: true });
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus({ preventScroll: true });
      }
    };
    overlay.addEventListener('keydown', onKey);
    return () => {
      hideSuggestions();
      overlay.removeEventListener('keydown', onKey);
      _overlays.delete(overlay);
      const remaining = [..._overlays].at(-1);
      if (remaining) remaining.inert = false;
      document.body.classList.toggle('modal-open', _overlays.size > 0);
      document.getElementById('screen-app').inert = _overlays.size > 0;
      if (previousFocus?.isConnected && !previousFocus.closest('[inert]')) previousFocus.focus({ preventScroll: true });
    };
  }

  function keepFocusedFieldVisible() {
    const field = document.activeElement;
    if (!field?.matches('input, textarea, select')) return;
    const owner = field.closest('.modal-body, .app-content');
    if (!owner) return;
    const bounds = owner.getBoundingClientRect();
    const rect = field.getBoundingClientRect();
    const v = viewportBounds();
    const top = Math.max(bounds.top, v.top) + 8;
    const bottom = Math.min(bounds.bottom, v.bottom) - 8;
    if (rect.bottom > bottom) owner.scrollTop += rect.bottom - bottom;
    else if (rect.top < top) owner.scrollTop -= top - rect.top;
  }

  function initLayout() {
    let frame;
    function updateViewport() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const v = viewportBounds();
        const style = document.documentElement.style;
        style.setProperty('--visible-height', `${v.height}px`);
        style.setProperty('--visible-width', `${v.width}px`);
        style.setProperty('--visible-top', `${v.top}px`);
        style.setProperty('--visible-left', `${v.left}px`);
        // El zoom conserva el tamaño de la página; el teclado sí reduce el espacio de trabajo.
        const zoomed = window.visualViewport?.scale > 1.05;
        style.setProperty('--app-height', zoomed ? '100dvh' : `${v.height}px`);
        style.setProperty('--app-top', zoomed ? '0px' : `${v.top}px`);
        keepFocusedFieldVisible();
        positionSuggestions();
      });
    }
    updateViewport();
    window.addEventListener('resize', updateViewport);
    window.visualViewport?.addEventListener('resize', updateViewport);
    window.visualViewport?.addEventListener('scroll', updateViewport);
    document.addEventListener('scroll', e => {
      if (_suggestions && e.target !== _suggestions.list) positionSuggestions();
    }, true);
    document.addEventListener('pointerdown', e => {
      if (_suggestions && e.target !== _suggestions.input && !_suggestions.list.contains(e.target)) hideSuggestions();
    });
    document.addEventListener('mousedown', e => {
      if (_suggestions?.list.contains(e.target)) e.preventDefault();
    });
    document.addEventListener('click', e => {
      if (_suggestions?.list.contains(e.target)) hideSuggestions();
    });
    document.addEventListener('focusin', e => {
      if (_suggestions && e.target !== _suggestions.input && !_suggestions.list.contains(e.target)) hideSuggestions();
      requestAnimationFrame(keepFocusedFieldVisible);
    });
    document.addEventListener('keydown', e => {
      if (!_suggestions || e.target !== _suggestions.input) return;
      const { input, list } = _suggestions;
      if (list.classList.contains('hidden')) { hideSuggestions(); return; }
      const options = [...list.children];
      let idx = options.findIndex(el => el.getAttribute('aria-selected') === 'true');
      if (e.key === 'Escape' || e.key === 'Tab') {
        if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); }
        hideSuggestions(); return;
      }
      if (e.key === 'Enter' && idx >= 0) {
        e.preventDefault(); e.stopImmediatePropagation(); options[idx].click(); hideSuggestions();
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault(); e.stopImmediatePropagation();
      idx = Math.max(0, Math.min(options.length - 1, idx + (e.key === 'ArrowDown' ? 1 : -1)));
      options.forEach((el, i) => el.setAttribute('aria-selected', String(i === idx)));
      const option = options[idx];
      if (!option) return;
      input.setAttribute('aria-activedescendant', option.id);
      const a = option.getBoundingClientRect(), b = list.getBoundingClientRect();
      if (a.bottom > b.bottom) list.scrollTop += a.bottom - b.bottom;
      else if (a.top < b.top) list.scrollTop -= b.top - a.top;
    }, true);
  }

  document.addEventListener('DOMContentLoaded', initLayout);

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
   * @param {'loading'|'app'} screenId
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
    // Evita apilar modales: cierra cualquier overlay existente primero
    if (_modalClose) _modalClose();

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
        btn.onclick = () => {
          if (onClick) {
            // Si onClick existe, NO cerramos automáticamente
            // El onClick es responsable de llamar modalRef.close() si procede
            onClick();
          } else {
            // Sin onClick = botón Cancelar → cierra directamente
            close();
          }
        };
        footer.appendChild(btn);
      });
    }

    modal.appendChild(header);
    modal.appendChild(body);
    if (footer) modal.appendChild(footer);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const release = attachOverlay(overlay, close);
    _modalClose = close;

    // Cierra al pulsar fuera del modal
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });

    // Foco en el primer elemento interactivo
    setTimeout(() => {
      const firstFocusable = modal.querySelector('input, select, textarea, button:not(.modal-close)');
      if (firstFocusable && modal.isConnected && !overlay.inert && !modal.contains(document.activeElement)) firstFocusable.focus({ preventScroll: true });
    }, 50);

    let _closed = false;
    function close() {
      if (_closed) return;
      _closed = true;
      overlay.remove();
      release();
      if (_modalClose === close) _modalClose = null;
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
      let _resolved = false;

      function done(value) {
        if (_resolved) return;
        _resolved = true;
        overlay.remove();
        release();
        resolve(value);
      }

      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';

      const modal = document.createElement('div');
      modal.className = 'modal';
      modal.setAttribute('role', 'alertdialog');
      modal.setAttribute('aria-modal', 'true');

      modal.innerHTML = `
        <div class="modal-header">
          <h2 class="modal-title">¿Estás seguro?</h2>
        </div>
        <div class="modal-body">
          <p class="text-sm">${message}</p>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="confirm-cancel">Cancelar</button>
          <button class="btn btn-danger"    id="confirm-ok">${confirmLabel}</button>
        </div>
      `;

      overlay.appendChild(modal);
      document.body.appendChild(overlay);

      const release = attachOverlay(overlay, () => done(false));
      modal.querySelector('#confirm-cancel').focus({ preventScroll: true });

      modal.querySelector('#confirm-cancel').addEventListener('click', () => done(false));
      modal.querySelector('#confirm-ok').addEventListener('click',     () => done(true));
      overlay.addEventListener('click', (e) => { if (e.target === overlay) done(false); });
    });
  }

  // ── Navigation ───────────────────────────────────────────────────

  /**
   * Activa una vista dentro del app shell.
   * Actualiza también el estado activo de la bottom nav.
   * @param {string} viewId
   */
  function activateView(viewId) {
    hideSuggestions();
    const content = document.getElementById('app-content');
    const previous = content?.querySelector('.view.active');
    if (previous?.id !== `view-${viewId}` && content) content.scrollTop = 0;
    // Oculta todas las views activas
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));

    // Activa la view destino — si no existe todavía, la crea vacía
    // para que los módulos puedan encontrarla con getElementById
    let target = document.getElementById(`view-${viewId}`);
    if (!target) {
      target = document.createElement('div');
      target.id = `view-${viewId}`;
      target.className = 'view';
      document.getElementById('app-content')?.appendChild(target);
    }
    target.classList.add('active');

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
    viewportBounds,
    showSuggestions,
    hideSuggestions,
    attachOverlay,
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
