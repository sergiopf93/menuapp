/**
 * MenuApp — Motor de sincronización
 * Detecta cambios externos en Drive y recarga los datos afectados.
 * Estrategia: last-write-wins con notificación al usuario ante conflictos.
 *
 * @module Sync
 */

const Sync = (() => {

  /** Intervalo de polling en milisegundos (60s activo, 5min en background) */
  const POLL_INTERVAL_ACTIVE = 60_000;
  const POLL_INTERVAL_BG     = 5 * 60_000;

  let _pollTimer = null;
  let _isActive  = true;

  /** Ficheros que se monitorizan para cambios externos */
  const WATCHED_FILES = ['inventario.json', 'platos.json', 'config.json', 'catalogo.json'];

  /** Callbacks registrados por módulo para cuando cambia un fichero */
  const _listeners = {};

  // ── API pública ──────────────────────────────────────────────────

  /**
   * Inicia el motor de sincronización.
   * Usa la Page Visibility API para ajustar el intervalo según si la app
   * está en primer plano o en background.
   */
  function start() {
    _schedulePoll();

    document.addEventListener('visibilitychange', () => {
      _isActive = document.visibilityState === 'visible';
      _schedulePoll();
    });

    // Sincroniza al recuperar conexión
    window.addEventListener('online', () => {
      UI.showToast('Conexión restaurada. Sincronizando...', 'info');
      _poll();
    });
  }

  /**
   * Detiene el motor de sincronización.
   */
  function stop() {
    if (_pollTimer) {
      clearTimeout(_pollTimer);
      _pollTimer = null;
    }
  }

  /**
   * Registra un listener que se ejecuta cuando cambia un fichero concreto.
   * @param {string}   fileName  - Nombre del fichero (ej: 'inventario.json')
   * @param {Function} callback  - Función a llamar con los nuevos datos
   */
  function onFileChange(fileName, callback) {
    if (!_listeners[fileName]) _listeners[fileName] = [];
    _listeners[fileName].push(callback);
  }

  /**
   * Fuerza una sincronización inmediata de todos los ficheros monitorizados.
   * Descarga siempre, independientemente de si ha cambiado o no.
   * @returns {Promise<void>}
   */
  async function syncNow() {
    if (!Auth.isAuthenticated()) return;

    UI.showToast('Sincronizando con Drive...', 'info', 2000);

    for (const fileName of WATCHED_FILES) {
      try {
        // Fuerza la descarga aunque el ETag no haya cambiado
        const data = await Drive.readJson(fileName);
        if (data !== null) {
          await Storage.set(`cache_${fileName}`, data);
          // Dispara los listeners registrados
          if (_listeners[fileName]) {
            _listeners[fileName].forEach(cb => {
              try { cb(data); } catch(e) { console.error('[Sync] Error en listener:', e); }
            });
          }
        }
      } catch (err) {
        console.warn(`[Sync] Error sincronizando ${fileName}:`, err.message);
      }
    }

    UI.showToast('✓ Datos actualizados', 'success');
  }

  // ── Privados ─────────────────────────────────────────────────────

  /**
   * Programa el siguiente ciclo de polling según si la app está activa.
   */
  function _schedulePoll() {
    if (_pollTimer) clearTimeout(_pollTimer);
    const interval = _isActive ? POLL_INTERVAL_ACTIVE : POLL_INTERVAL_BG;
    _pollTimer = setTimeout(async () => {
      if (Auth.isAuthenticated()) await _poll();
      _schedulePoll(); // re-programa
    }, interval);
  }

  /**
   * Comprueba cada fichero monitorizado y dispara listeners si hay cambios.
   */
  async function _poll() {
    for (const fileName of WATCHED_FILES) {
      try {
        const changed = await Drive.hasChanged(fileName);
        if (changed) {
          console.log(`[Sync] Cambio detectado en ${fileName}`);
          const newData = await Drive.readJson(fileName);

          // Actualiza la caché local
          await Storage.set(`cache_${fileName}`, newData);

          // Notifica a los listeners registrados
          if (_listeners[fileName]) {
            _listeners[fileName].forEach((cb) => {
              try { cb(newData); } catch (e) { console.error('[Sync] Error en listener:', e); }
            });
          }

          // Avisa al usuario
          _notifyUser(fileName);
        }
      } catch (err) {
        // No interrumpe el polling si un fichero falla
        console.warn(`[Sync] Error comprobando ${fileName}:`, err.message);
      }
    }
  }

  /**
   * Muestra un aviso al usuario cuando se detectan cambios externos.
   * @param {string} fileName
   */
  function _notifyUser(fileName) {
    const labels = {
      'inventario.json': 'despensa',
      'platos.json':     'catálogo de platos',
      'config.json':     'configuración',
    };
    const label = labels[fileName] || fileName;
    UI.showToast(`Tu pareja actualizó ${label}`, 'info', 4000);
  }

  // ── Export ───────────────────────────────────────────────────────
  return { start, stop, onFileChange, syncNow };

})();
