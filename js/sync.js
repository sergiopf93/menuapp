/**
 * MenuApp — Motor de sincronización offline-first
 *
 * Estrategia:
 * - Al arrancar: carga IndexedDB (instantáneo), muestra la app, compara ETags con Drive en background
 * - Cada cambio del usuario: escribe en memoria + IndexedDB + sube a Drive en background
 * - Sin red: trabaja en local, encola los cambios pendientes, sube al recuperar conexión
 * - Compra: lista atemporal, merge por nombre normalizado y marcas persistentes de retirada
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
    const fileName = 'lista_compra.json';
    compra = _mergeCompra(_pendientes[fileName]?.data, compra);
    if (navigator.onLine) {
      try {
        let convergida = false;
        for (let intento = 0; intento < 3; intento++) {
          compra = _mergeCompra(await readCompra(), compra);
          await Drive.writeJson(fileName, compra);
          const verificada = await Drive.readJson(fileName);
          const fusionada = _mergeCompra(verificada, compra);
          if (_mismoContenidoLista(verificada, fusionada)) {
            compra = fusionada;
            convergida = true;
            break;
          }
          compra = fusionada;
        }
        if (!convergida) await Drive.writeJson(fileName, compra);
        delete _pendientes[fileName];
        _savePendientes();
        await Storage.set(`cache_${fileName}`, compra);
        return compra;
      } catch(e) {
        console.warn('[Sync] Lista de compra pendiente de subir:', e.message);
      }
    }

    _pendientes[fileName] = { data: compra, ts: Date.now() };
    _savePendientes();
    await Storage.set(`cache_${fileName}`, compra);
    return compra;
  }

  async function readCompra() {
    const actual = await Drive.readJson('lista_compra.json');
    if (actual) return actual;

    // Migra al combinar las listas fechadas que guardaban versiones anteriores.
    const [archivosRaiz, archivosCarpeta] = await Promise.all([
      Drive.listRootJsonFiles(),
      Drive.listPurchaseFiles(),
    ]);
    const antiguas = [
      ...archivosRaiz.filter(f => /^(?:compras\/)?compra_.+\.json$/.test(f.name)).map(f => ({ ...f, enCarpeta: false })),
      ...archivosCarpeta.filter(f => /^compra_.+\.json$/.test(f.name)).map(f => ({ ...f, enCarpeta: true })),
    ]
      .sort((a, b) => (a.modifiedTime || '').localeCompare(b.modifiedTime || ''));
    let lista = null;
    for (const archivo of antiguas) {
      const anterior = await (archivo.enCarpeta
        ? Drive.readMenuJson(archivo.id)
        : Drive.readJson(archivo.name)).catch(()=>null);
      if (!anterior) continue;
      const fechaModificacion = archivo.modifiedTime || new Date().toISOString();
      const removidos = { ...(anterior.removidos || {}) };
      if (anterior.estado === 'completada') {
        (anterior.items || []).filter(item => item.comprado).forEach(item => {
          removidos[normalize(item.nombre)] = fechaModificacion;
        });
      }
      const items = (anterior.items || [])
        .filter(item => !item.enDespensa && !(anterior.estado === 'completada' && item.comprado))
        .map(item => ({ ...item, actualizadoEn: item.actualizadoEn || fechaModificacion }));
      lista = _mergeCompra(lista, { ...anterior, removidos, items });
    }
    return lista;
  }

  function _mismoContenidoLista(a, b) {
    return JSON.stringify(a?.removidos || {}) === JSON.stringify(b?.removidos || {}) &&
      JSON.stringify(a?.items || []) === JSON.stringify(b?.items || []);
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
   * Fusiona versiones de la lista por nombre normalizado y conserva las retiradas.
   */
  function _mergeCompra(base, nueva) {
    const removidos = { ...(base?.removidos || {}), ...(nueva?.removidos || {}) };
    const items = new Map();
    [...(base?.items || []), ...(nueva?.items || [])].forEach(item => {
      const key = normalize(item.nombre);
      if (!key) return;
      if (removidos[key] && (!item.actualizadoEn || item.actualizadoEn <= removidos[key])) return;
      if (item.actualizadoEn && removidos[key] && item.actualizadoEn > removidos[key]) delete removidos[key];
      const anterior = items.get(key);
      if (!anterior) {
        items.set(key, { ...item });
        return;
      }
      const itemMasReciente = (anterior.actualizadoEn || '') > (item.actualizadoEn || '') ? anterior : item;
      items.set(key, {
        ...anterior,
        ...item,
        id: anterior.id || item.id,
        cantidad: Math.max(Number(anterior.cantidad) || 0, Number(item.cantidad) || 0),
        comprado: !!itemMasReciente.comprado,
        noDisponible: !!itemMasReciente.noDisponible,
      });
    });

    return {
      ...(base || {}),
      ...(nueva || {}),
      id: 'lista-compra',
      fechaCreacion: null,
      estado: 'pendiente',
      fechaCierre: null,
      removidos,
      items: [...items.values()],
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
        if (fileName === 'lista_compra.json') {
          await saveCompra(_pendientes[fileName].data);
          if (_pendientes[fileName]) continue;
        } else {
          await Drive.writeJson(fileName, _pendientes[fileName].data);
        }
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

        // Llama a listeners registrados (actualiza vistas)
        if (_listeners[fileName]) {
          _listeners[fileName].forEach(cb => { try { cb(newData); } catch{} });
        }
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

  const _listeners = {};

  /** Registra un listener que se ejecuta cuando cambia un fichero en Drive */
  function onFileChange(fileName, callback) {
    if (!_listeners[fileName]) _listeners[fileName] = [];
    _listeners[fileName].push(callback);
  }

  // ── Export ────────────────────────────────────────────────────────
  return { start, stop, syncNow, save, saveMenu, saveCompra, readCompra, mergeCompras: _mergeCompra, isPending: fileName => !!_pendientes[fileName], normalize, onFileChange };

})();
