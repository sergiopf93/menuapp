/**
 * MenuApp — Motor de sincronización offline-first
 *
 * Estrategia:
 * - Al arrancar: carga IndexedDB (instantáneo), muestra la app, compara ETags con Drive en background
 * - Cada cambio del usuario: escribe en memoria + IndexedDB + sube a Drive en background
 * - Sin red: trabaja en local, encola los cambios pendientes, sube al recuperar conexión
 * - Conflicto compra: merge por ítem (deduplicación insensible a acentos/mayúsculas)
 * - Resto de ficheros: last-write-wins por modifiedTime
 *
 * @module Sync
 */

const Sync = (() => {

  const POLL_INTERVAL_ACTIVE = 60_000;    // 1 min en primer plano
  const POLL_INTERVAL_BG     = 5 * 60_000; // 5 min en background

  let _pollTimer  = null;
  let _isActive   = true;
  let _pendientes = {};  // { fileName: data } — cambios sin subir por falta de red

  /** Ficheros monitorizados y su estrategia de merge */
  const WATCHED = {
    'catalogo.json':   'last-write-wins',
    'inventario.json': 'last-write-wins',
    'platos.json':     'last-write-wins',
    'config.json':     'last-write-wins',
  };

  // ── Normalización ─────────────────────────────────────────────────

  /** Normaliza texto para comparaciones: minúsculas sin acentos */
  function normalize(str) {
    if (!str) return '';
    return str
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/ñ/g, 'n')
      .trim();
  }

  // ── API pública ───────────────────────────────────────────────────

  function start() {
    _loadPendientes();
    _schedulePoll();

    document.addEventListener('visibilitychange', () => {
      _isActive = document.visibilityState === 'visible';
      if (_isActive) _poll();  // comprueba cambios al volver al primer plano
      _schedulePoll();
    });

    window.addEventListener('online', async () => {
      UI.showToast('Conexión restaurada. Sincronizando...', 'info', 2000);
      await _subirPendientes();
      await _poll();
    });
  }

  function stop() {
    if (_pollTimer) { clearTimeout(_pollTimer); _pollTimer = null; }
  }

  /**
   * Guarda un fichero: escribe en memoria + IndexedDB + sube a Drive en background.
   * Es el método principal que usan todos los módulos para persistir cambios.
   */
  async function save(fileName, data) {
    // 1. Escribe en caché local (siempre, offline o no)
    await Storage.set(`cache_${fileName}`, data);

    // 2. Sube a Drive en background
    if (navigator.onLine) {
      try {
        await Drive.writeJson(fileName, data);
        // Elimina de pendientes si estaba
        delete _pendientes[fileName];
        _savePendientes();
      } catch(e) {
        console.warn(`[Sync] Error subiendo ${fileName}, queda pendiente:`, e.message);
        _pendientes[fileName] = { data, ts: Date.now() };
        _savePendientes();
      }
    } else {
      // Sin red: marca como pendiente
      _pendientes[fileName] = { data, ts: Date.now() };
      _savePendientes();
    }
  }

  /**
   * Guarda un menú semanal en Drive.
   */
  async function saveMenu(menu) {
    const fecha = menu.fechaInicio?.replace(/-/g,'') || Date.now();
    const fileName = `menus/semana_${fecha}.json`;
    await save(fileName, menu);
  }

  /**
   * Guarda la lista de la compra con merge inteligente.
   * Si hay una versión más reciente en Drive, hace merge por ítem antes de guardar.
   */
  async function saveCompra(compra) {
    const fecha = (compra.fechaCreacion||'').replace(/-/g,'') || Date.now();
    const fileName = `compras/compra_${fecha}.json`;

    // Intenta hacer merge con la versión en Drive (por si la pareja editó)
    if (navigator.onLine) {
      try {
        const driveCompra = await Drive.readJson(fileName).catch(()=>null);
        if (driveCompra) {
          compra = _mergeCompra(driveCompra, compra);
        }
      } catch(e) { /* sin problema, sube la local */ }
    }

    await save(fileName, compra);
    return compra;  // devuelve la versión mergeada
  }

  /**
   * Fuerza sincronización inmediata de todos los ficheros.
   */
  async function syncNow() {
    if (!Auth.isAuthenticated()) return;
    UI.showToast('Sincronizando...', 'info', 1500);
    await _subirPendientes();
    await _poll(true);  // fuerza descarga aunque ETag no haya cambiado
    UI.showToast('✓ Sincronizado', 'success', 2000);
  }

  // ── Merge de lista de la compra ───────────────────────────────────

  /**
   * Fusiona dos versiones de la lista de la compra.
   * Gana el ítem más reciente si hay conflicto; nunca duplica por nombre.
   */
  function _mergeCompra(base, nueva) {
    const itemsBase  = base.items  || [];
    const itemsNueva = nueva.items || [];

    // Índice de items base por nombre normalizado
    const idx = {};
    itemsBase.forEach(i => { idx[normalize(i.nombre)] = i; });

    // Añade los de la versión nueva que no existan (por nombre normalizado)
    itemsNueva.forEach(i => {
      const key = normalize(i.nombre);
      if (!idx[key]) {
        idx[key] = i;  // ítem nuevo de la pareja
      } else {
        // Si el mismo ítem existe en ambas, gana el estado más avanzado
        // (comprado > no-comprado; no-disponible se respeta)
        if (i.comprado && !idx[key].comprado) idx[key] = i;
        if (i.noDisponible) idx[key].noDisponible = true;
      }
    });

    return {
      ...nueva,  // metadatos de la versión más reciente
      items: Object.values(idx),
    };
  }

  // ── Pendientes ────────────────────────────────────────────────────

  function _savePendientes() {
    try { localStorage.setItem('menuapp_sync_pendientes', JSON.stringify(_pendientes)); } catch{}
  }

  function _loadPendientes() {
    try {
      const raw = localStorage.getItem('menuapp_sync_pendientes');
      _pendientes = raw ? JSON.parse(raw) : {};
    } catch { _pendientes = {}; }
  }

  async function _subirPendientes() {
    const keys = Object.keys(_pendientes);
    if (!keys.length) return;
    for (const fileName of keys) {
      try {
        await Drive.writeJson(fileName, _pendientes[fileName].data);
        delete _pendientes[fileName];
        console.log(`[Sync] Pendiente subido: ${fileName}`);
      } catch(e) {
        console.warn(`[Sync] Error subiendo pendiente ${fileName}:`, e.message);
      }
    }
    _savePendientes();
  }

  // ── Polling ───────────────────────────────────────────────────────

  function _schedulePoll() {
    if (_pollTimer) clearTimeout(_pollTimer);
    const interval = _isActive ? POLL_INTERVAL_ACTIVE : POLL_INTERVAL_BG;
    _pollTimer = setTimeout(async () => {
      if (Auth.isAuthenticated()) await _poll();
      _schedulePoll();
    }, interval);
  }

  async function _poll(forzar=false) {
    const state = App.getState();
    for (const [fileName, estrategia] of Object.entries(WATCHED)) {
      try {
        const changed = forzar || await Drive.hasChanged(fileName);
        if (!changed) continue;

        console.log(`[Sync] Cambio en Drive: ${fileName}`);
        const newData = await Drive.readJson(fileName);
        if (!newData) continue;

        await Storage.set(`cache_${fileName}`, newData);

        // Actualiza el estado en memoria
        const key = fileName.replace('.json','');
        if (key === 'catalogo')   state.catalogo   = newData;
        if (key === 'inventario') state.inventario  = newData;
        if (key === 'platos')     state.platos      = newData;
        if (key === 'config')     state.config      = newData;

        // Avisa al usuario si es cambio externo (no nuestro)
        if (!forzar) _notifyUser(fileName);

      } catch(e) {
        console.warn(`[Sync] Error en poll ${fileName}:`, e.message);
      }
    }
  }

  function _notifyUser(fileName) {
    const labels = {
      'inventario.json': 'la despensa',
      'platos.json':     'los platos',
      'config.json':     'la configuración',
      'catalogo.json':   'el catálogo',
    };
    UI.showToast(`Actualizado: ${labels[fileName]||fileName}`, 'info', 3000);
  }

  // ── Export ────────────────────────────────────────────────────────
  return { start, stop, syncNow, save, saveMenu, saveCompra, normalize };

})();
