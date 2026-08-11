/**
 * MenuApp — Utilidad de almacenamiento local (IndexedDB)
 * Wrapper simplificado para operaciones clave-valor en IndexedDB.
 * Usado como caché de sesión y almacenamiento offline.
 *
 * @module Storage
 */

const Storage = (() => {

  const DB_NAME    = 'menuapp_db';
  const DB_VERSION = 1;
  const STORE_NAME = 'kv_store';

  let _db = null;

  /**
   * Abre (o crea) la base de datos IndexedDB.
   * @returns {Promise<IDBDatabase>}
   */
  function _open() {
    if (_db) return Promise.resolve(_db);

    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };

      req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
      req.onerror   = ()  => reject(new Error('No se pudo abrir IndexedDB'));
    });
  }

  /**
   * Almacena un valor bajo una clave.
   * @param {string} key
   * @param {*}      value - Se serializa automáticamente
   * @returns {Promise<void>}
   */
  async function set(key, value) {
    const db = await _open();
    return new Promise((resolve, reject) => {
      const tx   = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req  = store.put(value, key);
      req.onsuccess = () => resolve();
      req.onerror   = () => reject(new Error(`Error guardando '${key}' en IndexedDB`));
    });
  }

  /**
   * Recupera el valor almacenado bajo una clave.
   * @param {string} key
   * @returns {Promise<*>} - null si no existe
   */
  async function get(key) {
    const db = await _open();
    return new Promise((resolve, reject) => {
      const tx    = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req   = store.get(key);
      req.onsuccess = (e) => resolve(e.target.result ?? null);
      req.onerror   = () => reject(new Error(`Error leyendo '${key}' de IndexedDB`));
    });
  }

  /**
   * Elimina una clave del almacenamiento.
   * @param {string} key
   * @returns {Promise<void>}
   */
  async function remove(key) {
    const db = await _open();
    return new Promise((resolve, reject) => {
      const tx    = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req   = store.delete(key);
      req.onsuccess = () => resolve();
      req.onerror   = () => reject(new Error(`Error eliminando '${key}' de IndexedDB`));
    });
  }

  /**
   * Limpia todo el almacenamiento local.
   * ⚠ Úsalo solo en logout o reset.
   * @returns {Promise<void>}
   */
  async function clear() {
    const db = await _open();
    return new Promise((resolve, reject) => {
      const tx    = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req   = store.clear();
      req.onsuccess = () => resolve();
      req.onerror   = () => reject(new Error('Error limpiando IndexedDB'));
    });
  }

  /** Guarda en localStorage (síncrono, para preferencias locales) */
  function setSync(key, value) {
    try { localStorage.setItem(`menuapp_${key}`, value); } catch{}
  }

  /** Lee de localStorage (síncrono) */
  function getSync(key) {
    try { return localStorage.getItem(`menuapp_${key}`); } catch { return null; }
  }

  return { set, get, remove, clear, setSync, getSync };

})();
