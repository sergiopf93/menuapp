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
  let _appIniciada = false;
  let _conectando = false;
  let _ultimaSyncCorrecta = false;

  async function boot() {
    _registerServiceWorker();
    UI.showScreen('loading');
    try {
      await _loadFromCache();
      await Auth.tryRestoreSession();
    } catch (err) {
      console.warn('[App] No se pudo recuperar la caché:', err.message);
      state.catalogo ||= [];
      state.inventario ||= [];
      state.platos ||= [];
      state.config ||= _defaultConfig();
    }
    state.usuario = Auth.getUserInfo();
    _abrirApp();
    // El SDK solo se necesita para renovar la autorización, nunca para abrir Inicio.
    Auth.init().catch(err => console.warn('[Auth]', err.message));
    if (Auth.isAuthenticated() && navigator.onLine) _sincronizarDriveBackground();
  }

  function _abrirApp() {
    UI.showScreen('app');
    if (!_appIniciada) {
      _appIniciada = true;
      _bindHeaderControls();
      _registerSyncListeners();
      Sync.start();
      Notificaciones.init();
      UI.maybeShowPWABanner();
      _scheduleNotificationCheck();
      window.addEventListener('online', () => {
        if (Auth.isAuthenticated()) _sincronizarDriveBackground();
        _renderDriveStatus();
      });
      window.addEventListener('offline', _renderDriveStatus);
    }
    navigate('dashboard');
  }

  async function _conectarGoogle() {
    if (_conectando) return;
    if (!navigator.onLine) {
      UI.showToast('Puedes seguir usando los datos locales. Conecta a internet para sincronizar.', 'info');
      return;
    }
    _conectando = true;
    try {
      if (!Auth.isAuthenticated()) {
        await Auth.init();
        await Auth.login();
        state.usuario = Auth.getUserInfo();
      }
      return await _sincronizarDriveBackground({ silent: false });
    } catch (err) {
      console.warn('[App] Conexión con Google:', err.message);
      UI.showToast(err.message, 'warning', 5000);
    } finally {
      _conectando = false;
      _renderDriveStatus();
    }
  }

  /** Carga la caché local y recupera los cambios pendientes antes de conectar con Drive. */
  async function _loadFromCache() {
    const [catalogo, inventario, platos, config] = await Promise.all([
      Storage.get('cache_catalogo.json'),
      Storage.get('cache_inventario.json'),
      Storage.get('cache_platos.json'),
      Storage.get('cache_config.json'),
    ]);

    state.catalogo   = Sync.getPendingData('catalogo.json') || catalogo || [];
    state.inventario = Sync.getPendingData('inventario.json') || inventario || [];
    state.platos     = Sync.getPendingData('platos.json') || platos || [];
    state.config     = Sync.getPendingData('config.json') || config || _defaultConfig();

  }

  /** Conecta Drive después de abrir la app y conserva los cambios locales pendientes. */
  async function _sincronizarDriveBackground({ silent = true } = {}) {
    if (!Auth.isAuthenticated() || !navigator.onLine) return false;
    try {
      await Drive.initFolderStructure();
      _ultimaSyncCorrecta = !!(await Sync.syncNow({ silent }));
      _renderDriveStatus();
      if (document.getElementById('view-dashboard')?.classList.contains('active')) {
        _renderDashboard();
      }
      return _ultimaSyncCorrecta;
    } catch (err) {
      _ultimaSyncCorrecta = false;
      console.warn('[Sync] Sincronización pendiente:', err.message);
      UI.showToast('No se pudo conectar con Drive. Tus cambios se conservan en este dispositivo.', 'warning');
      _renderDriveStatus();
      return false;
    }
  }

  // ── Navegación ───────────────────────────────────────────────────

  /**
   * Navega a una vista/módulo de la aplicación.
   * @param {'dashboard'|'inventario'|'menu'|'compra'|'config'|'historial'} viewName
   */
  function navigate(viewName) {
    UI.activateView(viewName);

    switch (viewName) {
      case 'dashboard':  _renderDashboard(); break;  // async, se ejecuta en background
      case 'inventario': Inventario.render();   break;
      case 'articulos':  Articulos.render();    break;
      case 'platos':     Platos.render();       break;
      case 'menu':       Menu.render();         break;
      case 'compra':     Compra.render();       break;
      case 'historial':  Historial.render();    break;
      case 'config':     Configuracion.render(); break;
    }
  }

  // ── Dashboard ────────────────────────────────────────────────────

  /**
   * Renderiza la pantalla de inicio con el resumen de la semana y las alertas.
   */
  async function _renderDashboard() {
    const view = document.getElementById('view-dashboard');
    if (!view) return;

    // Reconstruye el HTML completo del dashboard cada vez
    // (evita depender del HTML estático del index.html que puede estar desactualizado)
    view.innerHTML = `
      <section class="dashboard-section">
        <h2 class="section-title">Esta semana</h2>
        <div id="dashboard-menu-preview" class="card card-empty" style="text-align:center;padding:var(--space-6)">
          <div class="loading-spinner" style="margin:0 auto var(--space-3)"></div>
          <p class="text-sm text-muted">Cargando menú...</p>
        </div>
      </section>
      <section class="dashboard-section">
        <h2 class="section-title">Alertas</h2>
        <div id="dashboard-alerts" class="alerts-list">
          <p class="text-muted">Sin alertas pendientes.</p>
        </div>
      </section>
      <section class="dashboard-section">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-3)">
          <h2 class="section-title" style="margin:0">Accesos rápidos</h2>
          <button class="btn-text" id="dash-edit-accesos" style="font-size:var(--font-size-xs)">✏️ Editar</button>
        </div>
        <div class="quick-actions" id="dash-quick-actions"></div>
      </section>
      <section class="dashboard-section" id="debug-section">
        <h2 class="section-title">Estado del sistema</h2>
        <div id="drive-status" class="card">
          <p id="drive-status-text">Verificando conexión...</p>
        </div>
      </section>`;

    // Renderiza partes síncronas
    _renderAccesos();
    _renderAlerts();
    _renderDriveStatus();

    // Botón editar accesos — se re-registra porque el HTML se reconstruyó
    document.getElementById('dash-edit-accesos')
      ?.addEventListener('click', _editarAccesos);

    // Carga el calendario (async — puede tardar porque va a Drive)
    const calContainer = document.getElementById('dashboard-menu-preview');
    try {
      const calHtml = await Menu.getCalendarioHTML();
      if (calHtml && calContainer) {
        calContainer.className = '';
        calContainer.style.padding = '';
        calContainer.innerHTML = `
          <div class="menu-calendario-wrapper">${calHtml}</div>
          <div style="display:flex;gap:var(--space-3);margin-top:var(--space-3)">
            <button class="btn btn-secondary btn-sm" style="flex:1" onclick="App.navigate('menu')">✏️ Editar menú</button>
            <button class="btn btn-primary btn-sm" style="flex:1" onclick="App.navigate('compra')">🛒 Ir a la compra</button>
          </div>`;
      } else if (calContainer) {
        calContainer.innerHTML = `
          <p class="text-sm text-muted" style="margin-bottom:var(--space-4)">No hay menú para esta semana.</p>
          <button class="btn btn-primary" onclick="App.navigate('menu')">Generar menú</button>`;
      }
    } catch(e) {
      console.error('[Dashboard] Error cargando menú:', e);
      if (calContainer) {
        calContainer.innerHTML = `
          <p class="text-sm text-muted" style="margin-bottom:var(--space-4)">No hay menú generado.</p>
          <button class="btn btn-primary" onclick="App.navigate('menu')">Generar menú</button>`;
      }
    }
  }

  // Opciones disponibles para accesos directos
  const ACCESOS_OPCIONES = [
    { id:'menu',       icon:'📅', label:'Menú' },
    { id:'compra',     icon:'🛒', label:'Compra' },
    { id:'inventario', icon:'🥕', label:'Despensa' },
    { id:'platos',     icon:'🍽️', label:'Platos' },
    { id:'articulos',  icon:'📦', label:'Artículos' },
    { id:'historial',  icon:'📋', label:'Historial' },
    { id:'config',     icon:'⚙️', label:'Configuración' },
  ];

  function _renderAccesos() {
    const container = document.getElementById('dash-quick-actions');
    if (!container) return;

    let accesos = ['menu','compra','inventario','platos'];
    try {
      const guardados = Storage.getSync('accesos_rapidos');
      if (guardados) accesos = JSON.parse(guardados);
    } catch {}

    container.innerHTML = accesos.map(id => {
      const op = ACCESOS_OPCIONES.find(o=>o.id===id);
      if (!op) return '';
      return `<button class="quick-action-btn" onclick="App.navigate('${op.id}')">
        <span class="qa-icon">${op.icon}</span>
        <span class="qa-label">${op.label}</span>
      </button>`;
    }).join('');

    // Re-bind del botón editar (se destruye con innerHTML)
    document.getElementById('dash-edit-accesos')?.addEventListener('click', _editarAccesos);
  }

  function _editarAccesos() {
    const guardados = Storage.getSync('accesos_rapidos');
    const seleccionados = guardados ? JSON.parse(guardados) : ['menu','compra','inventario','platos'];

    const container = document.createElement('div');
    container.innerHTML = `
      <p class="text-sm text-muted" style="margin-bottom:var(--space-4)">Selecciona hasta 6 accesos directos que aparecerán en el inicio.</p>
      <div style="display:flex;flex-direction:column;gap:var(--space-2)">
        ${ACCESOS_OPCIONES.map(op => `
          <label style="display:flex;align-items:center;gap:var(--space-3);cursor:pointer;padding:var(--space-2) 0">
            <input type="checkbox" class="acceso-check" data-id="${op.id}"
                   ${seleccionados.includes(op.id)?'checked':''}/>
            <span>${op.icon} ${op.label}</span>
          </label>`).join('')}
      </div>`;

    let modalRef = UI.showModal({
      title: 'Editar accesos rápidos',
      content: container,
      buttons: [
        { label:'Cancelar', type:'secondary' },
        { label:'Guardar', type:'primary', onClick: () => {
          const checked = [...container.querySelectorAll('.acceso-check:checked')]
            .map(c=>c.dataset.id).slice(0,6);
          Storage.setSync('accesos_rapidos', JSON.stringify(checked));
          _renderAccesos();
          if(modalRef) modalRef.close();
        }},
      ],
    });
  }

  /**
   * Muestra las alertas de caducidad en el dashboard.
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
   * Muestra alertas de caducidad en el dashboard.
   */
  function _renderAlerts() {
    const container = document.getElementById('dashboard-alerts');
    if (!container) return;

    const inventario = state.inventario || [];
    const config     = state.config || {};
    const diasAlerta = config.notificaciones?.diasAlertaCaducidad || 7;
    const alerts     = [];

    inventario.forEach(item => {
      const status = Dates.expiryStatus(item.fechaCaducidad);
      if (status === 'expired') {
        alerts.push(`<div class="alert alert-error">
          ⚠ <strong>${UI.escapeHtml(item.nombre)}</strong> ha caducado.
        </div>`);
      } else if (status === 'urgent') {
        const dias = Dates.daysUntil(item.fechaCaducidad);
        alerts.push(`<div class="alert alert-warning">
          🕐 <strong>${UI.escapeHtml(item.nombre)}</strong> caduca en ${dias} día${dias!==1?'s':''}.
        </div>`);
      } else if (status === 'soon' && Dates.daysUntil(item.fechaCaducidad) <= diasAlerta) {
        const dias = Dates.daysUntil(item.fechaCaducidad);
        alerts.push(`<div class="alert alert-info">
          📅 <strong>${UI.escapeHtml(item.nombre)}</strong> caduca en ${dias} días.
        </div>`);
      }
    });

    container.innerHTML = alerts.length > 0
      ? alerts.join('')
      : '<p class="text-muted">Sin alertas pendientes.</p>';
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
    const conectado = rootFolderId && Auth.isAuthenticated() && isOnline && _ultimaSyncCorrecta;
    const syncBtn = document.getElementById('btn-sync');
    if (syncBtn) {
      syncBtn.title = Auth.isAuthenticated() ? 'Sincronizar' : 'Conectar con Google';
      syncBtn.setAttribute('aria-label', syncBtn.title);
    }

    el.innerHTML = `
      <p><span class="${conectado ? 'status-ok' : 'status-error'}">
        ${conectado ? '✓ Google Drive conectado' : rootFolderId && Auth.isAuthenticated() && isOnline ? 'Sincronización pendiente o incompleta' : 'Datos guardados en este dispositivo'}
      </span></p>
      ${!Auth.isAuthenticated() ? '<button class="btn btn-secondary btn-sm" id="btn-conectar-drive">Conectar con Google</button>' : ''}
      ${user ? `<p>👤 ${UI.escapeHtml(user.name)} (${UI.escapeHtml(user.email)})</p>` : ''}
      <p>${isOnline ? '🌐 Online' : '📴 Offline (modo caché)'}</p>
      <p>📦 ${state.inventario?.length ?? 0} en despensa · 🛒 ${state.catalogo?.length ?? 0} artículos · 🍽 ${state.platos?.length ?? 0} platos</p>
    `;
    document.getElementById('btn-conectar-drive')?.addEventListener('click', _conectarGoogle);
  }

  // ── Header ───────────────────────────────────────────────────────

  /**
   * Vincula los botones del header (sync, user menu).
   */
  function _bindHeaderControls() {
    document.getElementById('btn-sync')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-sync');
      if (btn) { btn.disabled = true; btn.style.opacity = '0.5'; }
      try { await _conectarGoogle(); }
      finally { if (btn) { btn.disabled = false; btn.style.opacity = '1'; } }
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
          ...(!Auth.isAuthenticated() ? [{ label: 'Conectar con Google', type: 'primary', onClick: _conectarGoogle }] : []),
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
      case 'compra':     Compra.refresh();       break;
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
      navigator.serviceWorker.register('./service-worker.js').catch((err) => {
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
          id: 'dia_facil',
          nombre: 'Día fácil',
          afectaA: 'todos',
          esDiaFacil: true,
          facilMomentos: ['comida', 'cena'],
          afectaComida: false,
          afectaCena: false,
          generaMayores: true,
          generaBebe: true,
        },
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
   */
  async function setState(key, value) {
    state[key] = value;
    const FILE_MAP = {
      catalogo:   'catalogo.json',
      inventario: 'inventario.json',
      platos:     'platos.json',
      config:     'config.json',
    };
    const fileName = FILE_MAP[key];
    if (fileName) {
      await Sync.save(fileName, value);
    }
  }

  // ── Export ───────────────────────────────────────────────────────
  return { boot, navigate, getState, setState };

})();

// Arranca la app cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', App.boot);
