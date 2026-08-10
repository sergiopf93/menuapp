/**
 * MenuApp — Controlador principal
 * Gestiona el arranque, la autenticación, la carga inicial de datos
 * y el enrutamiento entre módulos.
 *
 * @module App
 */

const App = (() => {

  /** Estado global de la aplicación en memoria */
  const state = {
    inventario:  null,
    platos:      null,
    catalogo:    null,   // catálogo de artículos comprables
    config:      null,
    menuActual:  null,
    compraActual:null,
    usuario:     null,
  };

  // ── Arranque ─────────────────────────────────────────────────────

  /**
   * Punto de entrada de la aplicación.
   * Se llama al cargar el DOM.
   */
  async function boot() {
    // Registra el Service Worker
    _registerServiceWorker();

    // Muestra la pantalla de carga
    UI.showScreen('loading');
    UI.setLoadingMessage('Iniciando MenuApp...');

    try {
      // 1. Inicializa Auth
      await Auth.init();

      // 2. Intenta restaurar sesión previa
      const hasSession = await Auth.tryRestoreSession();

      if (hasSession) {
        await _onAuthenticated();
      } else {
        _showLogin();
      }
    } catch (err) {
      console.error('[App] Error en arranque:', err);
      UI.showScreen('login');
      UI.showToast('Error al iniciar la app. Inténtalo de nuevo.', 'error');
    }
  }

  // ── Login ────────────────────────────────────────────────────────

  /**
   * Muestra la pantalla de login y vincula el botón de Google.
   */
  function _showLogin() {
    UI.showScreen('login');
    const btn = document.getElementById('btn-google-login');
    if (btn) {
      btn.onclick = _handleLogin;
    }
  }

  /**
   * Gestiona el click en "Acceder con Google".
   */
  async function _handleLogin() {
    const btn = document.getElementById('btn-google-login');
    if (btn) btn.disabled = true;

    try {
      UI.showScreen('loading');
      UI.setLoadingMessage('Conectando con Google...');
      await Auth.login();
      await _onAuthenticated();
    } catch (err) {
      console.error('[App] Error en login:', err);
      UI.showScreen('login');
      UI.showToast('No se pudo iniciar sesión. Verifica tu conexión.', 'error');
      if (btn) btn.disabled = false;
    }
  }

  // ── Post-autenticación ───────────────────────────────────────────

  /**
   * Se ejecuta tras una autenticación exitosa.
   * Carga datos de Drive y muestra la app.
   */
  async function _onAuthenticated() {
    state.usuario = Auth.getUserInfo();

    try {
      // Inicializa estructura de Drive
      await Drive.initFolderStructure();

      // Carga datos iniciales
      await _loadInitialData();

      // Muestra la app
      UI.showScreen('app');
      navigate('dashboard');

      // Vincula controles del header
      _bindHeaderControls();

      // Inicia sincronización en background
      Sync.start();
      _registerSyncListeners();

      // Inicia sistema de notificaciones
      Notificaciones.init();

      // Muestra banner PWA si aplica
      UI.maybeShowPWABanner();

      // Programa comprobación de notificaciones
      _scheduleNotificationCheck();

      // Muestra estado de Drive en el dashboard
      _renderDriveStatus();

    } catch (err) {
      console.error('[App] Error cargando datos:', err);
      UI.showScreen('login');
      UI.showToast(`Error: ${err.message}`, 'error', 6000);
      _showLogin();
    }
  }

  /**
   * Carga inventario, platos y configuración desde Drive (o caché local).
   */
  /**
   * Carga todos los ficheros de datos desde Drive.
   * Siempre va a Drive en el arranque para garantizar datos frescos.
   * La caché local (IndexedDB) se usa solo como fallback offline.
   */
  async function _loadInitialData() {
    UI.setLoadingMessage('Cargando catálogo de artículos...');
    state.catalogo   = await Drive.readJson('catalogo.json')
                       ?? await Storage.get('cache_catalogo.json')
                       ?? [];

    UI.setLoadingMessage('Cargando inventario...');
    state.inventario = await Drive.readJson('inventario.json')
                       ?? await Storage.get('cache_inventario.json')
                       ?? [];

    UI.setLoadingMessage('Cargando catálogo de platos...');
    state.platos     = await Drive.readJson('platos.json')
                       ?? await Storage.get('cache_platos.json')
                       ?? [];

    UI.setLoadingMessage('Cargando configuración...');
    state.config     = await Drive.readJson('config.json')
                       ?? await Storage.get('cache_config.json')
                       ?? _defaultConfig();

    // Si config no existía en Drive, la crea
    if (!state.config.version) {
      state.config = _defaultConfig();
      await Drive.writeJson('config.json', state.config);
    }

    // Actualiza la caché local con los datos frescos de Drive
    await Storage.set('cache_catalogo.json',   state.catalogo);
    await Storage.set('cache_inventario.json', state.inventario);
    await Storage.set('cache_platos.json',     state.platos);
    await Storage.set('cache_config.json',     state.config);
  }

  // ── Navegación ───────────────────────────────────────────────────

  /**
   * Navega a una vista/módulo de la aplicación.
   * @param {'dashboard'|'inventario'|'menu'|'compra'|'config'|'historial'} viewName
   */
  function navigate(viewName) {
    UI.activateView(viewName);

    // Inicializa / renderiza el módulo correspondiente
    switch (viewName) {
      case 'dashboard':  _renderDashboard();    break;
      case 'inventario': Inventario.render();   break;
      case 'articulos':  Articulos.render();    break;
      case 'platos':     Platos.render();       break;
      case 'menu':       Menu.render();         break;
      case 'compra':     Compra.render();       break;
      case 'historial':  Historial.render();     break;
      case 'config':     Configuracion.render(); break;
    }
  }

  // ── Dashboard ────────────────────────────────────────────────────

  /**
   * Renderiza la pantalla de inicio con el resumen de la semana y las alertas.
   */
  async function _renderDashboard() {
    _renderAlerts();
    _renderDriveStatus();
    // Carga y muestra el calendario de menú en el dashboard
    const calHtml = await Menu.getCalendarioHTML().catch(()=>null);
    const calContainer = document.getElementById('dashboard-menu-preview');
    if (calContainer && calHtml) {
      calContainer.innerHTML = `
        <div class="menu-calendario-wrapper">${calHtml}</div>
        <div style="display:flex;gap:var(--space-3);margin-top:var(--space-3)">
          <button class="btn btn-secondary btn-sm" style="flex:1" onclick="App.navigate('menu')">✏️ Editar menú</button>
          <button class="btn btn-primary btn-sm" style="flex:1" onclick="App.navigate('compra')">🛒 Ir a la compra</button>
        </div>`;
    }
  }

  /**
   * Muestra las alertas de caducidad en el dashboard.
   */
  function _renderAlerts() {
    const container = document.getElementById('dashboard-alerts');
    if (!container || !state.inventario) return;

    const alerts = [];

    state.inventario.forEach((item) => {
      const status = Dates.expiryStatus(item.fechaCaducidad);
      if (status === 'expired') {
        alerts.push({
          type: 'danger',
          icon: '⚠️',
          text: `<strong>${UI.escapeHtml(item.nombre)}</strong> ha caducado. Revisa la ${item.ubicacion}.`,
        });
      } else if (status === 'urgent') {
        const days = Dates.daysUntil(item.fechaCaducidad);
        alerts.push({
          type: 'warning',
          icon: '🕐',
          text: `<strong>${UI.escapeHtml(item.nombre)}</strong> caduca en ${days} día${days !== 1 ? 's' : ''}.`,
        });
      }
    });

    if (alerts.length === 0) {
      container.innerHTML = '<p class="text-muted text-sm">Sin alertas pendientes.</p>';
      return;
    }

    container.innerHTML = alerts
      .map(a => `
        <div class="alert-item ${a.type}">
          <span class="alert-icon">${a.icon}</span>
          <span>${a.text}</span>
        </div>`)
      .join('');
  }

  /**
   * Muestra el estado de la conexión con Drive en el bloque de debug del dashboard.
   */
  function _renderDriveStatus() {
    const el = document.getElementById('drive-status-text');
    if (!el) return;

    const { rootFolderId } = Drive.getFolderIds();
    const user = Auth.getUserInfo();
    const isOnline = navigator.onLine;

    el.innerHTML = `
      <p><span class="${rootFolderId ? 'status-ok' : 'status-error'}">
        ${rootFolderId ? '✓ Google Drive conectado' : '✗ Sin conexión a Drive'}
      </span></p>
      ${user ? `<p>👤 ${UI.escapeHtml(user.name)} (${UI.escapeHtml(user.email)})</p>` : ''}
      <p>${isOnline ? '🌐 Online' : '📴 Offline (modo caché)'}</p>
      <p>📦 ${state.inventario?.length ?? 0} en despensa · 🛒 ${state.catalogo?.length ?? 0} artículos · 🍽 ${state.platos?.length ?? 0} platos</p>
    `;
  }

  // ── Header ───────────────────────────────────────────────────────

  /**
   * Vincula los botones del header (sync, user menu).
   */
  function _bindHeaderControls() {
    document.getElementById('btn-sync')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-sync');
      if (btn) btn.style.opacity = '0.5';
      await Sync.syncNow();
      if (btn) btn.style.opacity = '1';
    });

    document.getElementById('btn-user-menu')?.addEventListener('click', () => {
      const user = Auth.getUserInfo();
      UI.showModal({
        title: 'Mi cuenta',
        content: user
          ? `<p class="text-sm">Has iniciado sesión como:</p>
             <p class="font-bold mt-2">${UI.escapeHtml(user.name)}</p>
             <p class="text-sm text-muted">${UI.escapeHtml(user.email)}</p>`
          : '<p>Sin sesión activa.</p>',
        buttons: [
          {
            label: 'Cerrar sesión',
            type: 'danger',
            onClick: async () => {
              await Auth.logout();
              await Storage.clear();
              location.reload();
            },
          },
        ],
      });
    });
  }

  // ── Sync listeners ───────────────────────────────────────────────

  /**
   * Registra los callbacks de sincronización para actualizar el estado
   * cuando otro usuario modifica los datos en Drive.
   */
  function _registerSyncListeners() {
    Sync.onFileChange('inventario.json', (data) => {
      state.inventario = data;
      _reRenderActiveView();
    });
    Sync.onFileChange('platos.json', (data) => {
      state.platos = data;
      _reRenderActiveView();
    });
    Sync.onFileChange('config.json', (data) => {
      state.config = data;
      _reRenderActiveView();
    });
    Sync.onFileChange('catalogo.json', (data) => {
      state.catalogo = data;
      _reRenderActiveView();
    });
  }

  /**
   * Re-renderiza la vista activa si depende de los datos que acaban de cambiar.
   * Evita recargar páginas que no están visibles.
   */
  function _reRenderActiveView() {
    const activeView = document.querySelector('.view.active');
    if (!activeView) return;
    const viewId = activeView.id?.replace('view-', '');
    if (!viewId) return;

    // Vuelve a renderizar la vista activa para reflejar los nuevos datos
    switch (viewId) {
      case 'dashboard':  _renderDashboard();     break;
      case 'inventario': Inventario.render();    break;
      case 'articulos':  Articulos.render();     break;
      case 'platos':     Platos.render();        break;
      case 'compra':     Compra.render();        break;
      case 'historial':  Historial.render();     break;
      case 'config':     Configuracion.render(); break;
      // 'menu' no se re-renderiza automáticamente para no interrumpir
      // al usuario si está en medio del asistente de generación
    }
  }

  // ── Notificaciones ───────────────────────────────────────────────

  /**
   * Programa la comprobación diaria de notificaciones a través del Service Worker.
   */
  function _scheduleNotificationCheck() {
    if (!('serviceWorker' in navigator) || !state.config?.notificaciones) return;

    const notificaciones = state.config.notificaciones?.pendientes || [];
    navigator.serviceWorker.ready.then((reg) => {
      reg.active?.postMessage({ type: 'CHECK_NOTIFICATIONS', notifications: notificaciones });
    });
  }

  // ── Service Worker ───────────────────────────────────────────────

  /**
   * Registra el Service Worker si el navegador lo soporta.
   */
  function _registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/service-worker.js').catch((err) => {
        console.warn('[App] Service Worker no registrado:', err.message);
      });
    }
  }

  // ── Config por defecto ───────────────────────────────────────────

  /**
   * Genera la configuración inicial cuando la app se usa por primera vez.
   * @returns {object}
   */
  function _defaultConfig() {
    return {
      version: '1.0',
      supermercados: [
        {
          id: 'mercadona-pozuelo',
          nombre: 'Mercadona Pozuelo',
          secciones: [
            'Frutas y verduras',
            'Panadería',
            'Charcutería',
            'Carnicería',
            'Pescadería',
            'Lácteos',
            'Huevos',
            'Congelados',
            'Envasados',
            'Bebidas',
            'Droguería',
          ],
        },
        {
          id: 'mercadona-madrid',
          nombre: 'Mercadona Madrid',
          secciones: [
            'Frutas y verduras',
            'Panadería',
            'Charcutería',
            'Carnicería',
            'Pescadería',
            'Lácteos',
            'Huevos',
            'Congelados',
            'Envasados',
            'Bebidas',
            'Droguería',
          ],
        },
      ],
      tiposDiaEspecial: [
        {
          id: 'fuera_todo',
          nombre: 'Fuera de casa (todo el día)',
          afectaA: 'todos',
          afectaComida: true,
          afectaCena: true,
          generaMayores: false,
          generaBebe: false,
        },
        {
          id: 'fuera_comida',
          nombre: 'Comida fuera de casa',
          afectaA: 'todos',
          afectaComida: true,
          afectaCena: false,
          generaMayores: false,
          generaBebe: false,
        },
        {
          id: 'fuera_cena',
          nombre: 'Cena fuera de casa',
          afectaA: 'todos',
          afectaComida: false,
          afectaCena: true,
          generaMayores: false,
          generaBebe: false,
        },
        {
          id: 'sin_bebe',
          nombre: 'Sin bebé (todo el día)',
          afectaA: 'bebe',
          afectaComida: true,
          afectaCena: true,
          generaMayores: true,
          generaBebe: false,
        },
      ],
      personas: [
        { id: 'adulto-1', nombre: 'Adulto 1', tipo: 'adulto' },
        { id: 'adulto-2', nombre: 'Adulto 2', tipo: 'adulto' },
        { id: 'bebe-1',   nombre: 'Bebé',     tipo: 'bebe'   },
      ],
      configuracionMenus: {
        frecuenciaMinSemanasPorDefecto: 2,
        equilibrioProteinas: true,
        equilibrioComidaCena: true,
      },
      notificaciones: {
        activadas: true,
        pendientes: [],
        horasAntelacionCongelador: 24,
        diasAlertaCaducidad: 7,
      },
      creadoEn: new Date().toISOString(),
      actualizadoEn: new Date().toISOString(),
    };
  }

  // ── Acceso al estado global ──────────────────────────────────────

  /** @returns {object} Estado global de la app */
  function getState() { return state; }

  /**
   * Actualiza una parte del estado y persiste en Drive y caché.
   * @param {'inventario'|'platos'|'config'} key
   * @param {*} value
   */
  /**
   * Actualiza una parte del estado y persiste en Drive y caché.
   * @param {'inventario'|'platos'|'config'|'catalogo'} key
   * @param {*} value
   */
  async function setState(key, value) {
    state[key] = value;                          // ← actualiza memoria primero
    const fileName = `${key}.json`;
    await Storage.set(`cache_${fileName}`, value);
    await Drive.writeJson(fileName, value);
  }

  // ── Export ───────────────────────────────────────────────────────
  return { boot, navigate, getState, setState };

})();

// Arranca la app cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', App.boot);
