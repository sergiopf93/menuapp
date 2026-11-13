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
  let _pendientes = {};  // { fileName: { data, ts } }
  let _pendientesCargados = false;
  let _started = false;
  let _pollRunning = null;
  const _queues = new Map();
  const _revisions = {};

  const _snapshot = data => JSON.parse(JSON.stringify(data));

  function _queue(fileName, task) {
    const previous = _queues.get(fileName) || Promise.resolve();
    const current = previous.catch(() => {}).then(task);
    _queues.set(fileName, current);
    const cleanup = () => { if (_queues.get(fileName) === current) _queues.delete(fileName); };
    current.then(cleanup, cleanup);
    return current;
  }

  function _canSync() {
    return navigator.onLine && Auth.isAuthenticated() &&
      (!Drive.getFolderIds || !!Drive.getFolderIds().rootFolderId);
  }

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
    if (_started) return _pollRunning || Promise.resolve();
    _started = true;
    _isActive = document.visibilityState === 'visible';
    document.addEventListener('visibilitychange', _onVisibilityChange);
    window.addEventListener('online', _onOnline);
    _schedulePoll();
    return _poll();
  }

  function _onVisibilityChange() {
    _isActive = document.visibilityState === 'visible';
    if (_isActive) _poll();
    _schedulePoll();
  }

  function _onOnline() {
    UI.showToast('Conexión restaurada. Sincronizando...', 'info', 2000);
    return _poll();
  }

  function stop() {
    _started = false;
    if (_pollTimer) { clearTimeout(_pollTimer); _pollTimer = null; }
    document.removeEventListener('visibilitychange', _onVisibilityChange);
    window.removeEventListener('online', _onOnline);
  }

  /** Guarda una instantánea local antes de intentar subirla. */
  async function save(fileName, data) {
    const entry = _enqueue(fileName, data);
    await _queue(fileName, async () => {
      await Storage.set(`cache_${fileName}`, entry.data);
      await _upload(fileName, entry);
    });
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
    _loadPendientes();
    const entry = _enqueue(fileName, _mergeCompra(_pendientes[fileName]?.data, compra));
    return _queue(fileName, async () => {
      await Storage.set(`cache_${fileName}`, entry.data);
      const result = await _upload(fileName, entry);
      return _snapshot(_pendientes[fileName]?.data || result);
    });
  }

  async function _writeCompra(compra) {
    for (let intento = 0; intento < 3; intento++) {
      compra = _mergeCompra(await readCompra(), compra);
      await Drive.writeJson('lista_compra.json', compra);
      const verificada = await Drive.readJson('lista_compra.json');
      const fusionada = _mergeCompra(verificada, compra);
      if (_mismoContenidoLista(verificada, fusionada)) return fusionada;
      compra = fusionada;
    }
    // El merge reduce conflictos, pero Drive no ofrece aquí una escritura condicional.
    await Drive.writeJson('lista_compra.json', compra);
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
  async function syncNow({ silent = false } = {}) {
    if (!Auth.isAuthenticated()) return;
    if (!silent) UI.showToast('Sincronizando...', 'info', 1500);
    const descargado = await _poll(true);  // fuerza descarga aunque ETag no haya cambiado
    const pendiente = Object.keys(_pendientes).length > 0;
    const sincronizado = descargado && !pendiente;
    if (!silent) {
      const mensaje = pendiente ? 'Hay cambios pendientes de sincronizar'
        : sincronizado ? '✓ Sincronizado' : 'No se pudo completar la sincronización';
      UI.showToast(mensaje, sincronizado ? 'success' : 'warning', 2000);
    }
    return sincronizado;
  }

  // ── Merge de lista de la compra ───────────────────────────────────

  /**
   * Fusiona versiones de la lista por nombre normalizado y conserva las retiradas.
   */
  function _mergeCompra(base, nueva) {
    const removidos = {};
    for (const lista of [base, nueva]) {
      for (const [nombre, fecha] of Object.entries(lista?.removidos || {})) {
        const key = normalize(nombre);
        if (key && fecha > (removidos[key] || '')) removidos[key] = fecha;
      }
    }
    const items = new Map();
    [...(base?.items || []), ...(nueva?.items || [])].forEach(item => {
      const key = normalize(item.nombre);
      if (!key) return;
      if (removidos[key] && (!item.actualizadoEn || item.actualizadoEn <= removidos[key])) return;
      const anterior = items.get(key);
      if (!anterior) {
        items.set(key, { ...item });
        return;
      }
      const itemMasReciente = (anterior.actualizadoEn || '') > (item.actualizadoEn || '') ? anterior : item;
      items.set(key, {
        ...anterior,
        ...item,
        ...itemMasReciente,
        id: anterior.id || item.id,
        cantidad: (anterior.actualizadoEn || '') !== (item.actualizadoEn || '')
          ? itemMasReciente.cantidad
          : Math.max(Number(anterior.cantidad) || 0, Number(item.cantidad) || 0),
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
    try { localStorage.setItem('menuapp_sync_pendientes', JSON.stringify(_pendientes)); }
    catch (e) { console.warn('[Sync] No se pudo persistir la cola local:', e.message); }
  }

  function _loadPendientes() {
    if (_pendientesCargados) return;
    _pendientesCargados = true;
    try {
      const raw = JSON.parse(localStorage.getItem('menuapp_sync_pendientes') || '{}');
      for (const [fileName, entry] of Object.entries(raw || {})) {
        if (!entry || !Object.hasOwn(entry, 'data')) continue;
        _pendientes[fileName] = entry;
        _revisions[fileName] = 1;
      }
    } catch (e) { console.warn('[Sync] No se pudo leer la cola local:', e.message); }
  }

  function _enqueue(fileName, data) {
    _loadPendientes();
    const entry = { data: _snapshot(data), ts: Date.now() };
    _revisions[fileName] = (_revisions[fileName] || 0) + 1;
    _pendientes[fileName] = entry;
    _savePendientes();
    return entry;
  }

  function getRevision(fileName) {
    _loadPendientes();
    return _revisions[fileName] || 0;
  }

  function getPendingData(fileName) {
    _loadPendientes();
    return _pendientes[fileName] ? _snapshot(_pendientes[fileName].data) : null;
  }

  async function _upload(fileName, entry) {
    if (!_canSync() || _pendientes[fileName] !== entry) return entry.data;
    let data = entry.data;
    try {
      if (fileName === 'lista_compra.json') data = await _writeCompra(data);
      else if (fileName.startsWith('menus/')) await Drive.writeMenuJson(fileName.slice(6), data);
      else await Drive.writeJson(fileName, data);
      if (_pendientes[fileName] === entry) {
        await Storage.set(`cache_${fileName}`, data);
        if (_pendientes[fileName] === entry) {
          delete _pendientes[fileName];
          _savePendientes();
        }
      }
    } catch (e) {
      console.warn(`[Sync] Error subiendo ${fileName}, queda pendiente:`, e.message);
    }
    return data;
  }

  async function _subirPendientes() {
    _loadPendientes();
    if (!_canSync()) return;
    for (const fileName of Object.keys(_pendientes)) {
      const entry = _pendientes[fileName];
      if (entry) await _queue(fileName, () => _upload(fileName, entry));
    }
  }

  // ── Polling ───────────────────────────────────────────────────────

  function _schedulePoll() {
    if (!_started) return;
    if (_pollTimer) clearTimeout(_pollTimer);
    const interval = _isActive ? POLL_INTERVAL_ACTIVE : POLL_INTERVAL_BG;
    _pollTimer = setTimeout(async () => {
      if (Auth.isAuthenticated()) await _poll();
      _schedulePoll();
    }, interval);
  }

  function _poll(forzar=false) {
    if (_pollRunning) return forzar ? _pollRunning.then(() => _poll(true)) : _pollRunning;
    _pollRunning = _runPoll(forzar).finally(() => { _pollRunning = null; });
    return _pollRunning;
  }

  async function _runPoll(forzar) {
    await _subirPendientes();
    if (!_canSync()) return false;
    let descargado = true;
    const state = App.getState();
    for (const fileName of Object.keys(WATCHED)) {
      try {
        if (_pendientes[fileName]) continue;
        const revision = getRevision(fileName);
        const changed = forzar || await Drive.hasChanged(fileName);
        if (!changed || _pendientes[fileName] || getRevision(fileName) !== revision) continue;
        const newData = await Drive.readJson(fileName);
        if (!newData) continue;

        await _queue(fileName, async () => {
          if (_pendientes[fileName] || getRevision(fileName) !== revision) return;
          await Storage.set(`cache_${fileName}`, newData);
          if (_pendientes[fileName] || getRevision(fileName) !== revision) return;
          const key = fileName.replace('.json', '');
          if (JSON.stringify(state[key]) === JSON.stringify(newData)) return;
          state[key] = newData;
          if (_listeners[fileName]) {
            _listeners[fileName].forEach(cb => { try { cb(newData); } catch {} });
          }
          if (!forzar) _notifyUser(fileName);
        });
      } catch(e) {
        descargado = false;
        console.warn(`[Sync] Error en poll ${fileName}:`, e.message);
      }
    }
    return descargado;
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
  return { start, stop, syncNow, save, saveMenu, saveCompra, readCompra, mergeCompras: _mergeCompra, isPending: fileName => getPendingData(fileName) !== null, getPendingData, getRevision, normalize, onFileChange };

})();
