/**
 * MenuApp — Capa de acceso a Google Drive
 * Todas las operaciones de lectura/escritura de ficheros JSON en Drive.
 * Usa la API REST v3 de Google Drive directamente desde el navegador.
 *
 * @module Drive
 */

const Drive = (() => {

  const BASE_URL = 'https://www.googleapis.com/drive/v3';
  const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3';

  /** Nombre de la carpeta raíz en Google Drive */
  const ROOT_FOLDER_NAME = 'MenuApp';

  /** IDs de carpetas y ficheros cacheados en memoria para esta sesión */
  const _cache = {
    rootFolderId: null,
    menusFolderId: null,
    comprasFolderId: null,
    backupsFolderId: null,
    fileIds: {}, // nombre → id
    etags: {},   // nombre → modifiedTime (para detectar cambios)
  };

  // ── API pública ──────────────────────────────────────────────────

  /**
   * Inicializa la estructura de carpetas en Drive.
   * Crea las carpetas necesarias si no existen.
   * @returns {Promise<{ rootId: string, menusId: string, comprasId: string }>}
   */
  async function initFolderStructure() {
    UI.setLoadingMessage('Verificando estructura en Google Drive...');

    _cache.rootFolderId    = await _ensureFolder(ROOT_FOLDER_NAME, 'root');
    _cache.menusFolderId   = await _ensureFolder('menus',   _cache.rootFolderId);
    _cache.comprasFolderId = await _ensureFolder('compras', _cache.rootFolderId);
    _cache.backupsFolderId = await _ensureFolder('backups', _cache.rootFolderId);

    // Guarda el ID de la carpeta raíz en IndexedDB para sesiones futuras
    await Storage.set('drive_root_folder_id', _cache.rootFolderId);

    return {
      rootId:    _cache.rootFolderId,
      menusId:   _cache.menusFolderId,
      comprasId: _cache.comprasFolderId,
    };
  }

  /**
   * Lee un fichero JSON de Drive por su nombre dentro de la carpeta raíz.
   * @param {string} fileName - Nombre del fichero (ej: 'inventario.json')
   * @returns {Promise<object|null>} - Objeto parseado o null si no existe
   */
  async function readJson(fileName) {
    const fileId = await _getFileId(fileName, _cache.rootFolderId);
    if (!fileId) return null;

    const token = Auth.getAccessToken();
    const res = await fetch(`${BASE_URL}/files/${fileId}?alt=media`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      if (res.status === 404) return null;
      throw new Error(`Error leyendo ${fileName}: ${res.status}`);
    }

    const data = await res.json();

    // Actualiza el ETag para detección de cambios
    await _updateEtag(fileId, fileName);

    return data;
  }

  /**
   * Escribe o actualiza un fichero JSON en la carpeta raíz de Drive.
   * Si el fichero no existe lo crea; si existe lo actualiza.
   * @param {string} fileName - Nombre del fichero
   * @param {object} data     - Objeto a serializar como JSON
   * @returns {Promise<string>} - ID del fichero en Drive
   */
  async function writeJson(fileName, data) {
    const content = JSON.stringify(data, null, 2);
    const blob = new Blob([content], { type: 'application/json' });

    const existingId = await _getFileId(fileName, _cache.rootFolderId);

    if (existingId) {
      return _updateFile(existingId, blob);
    } else {
      return _createFile(fileName, blob, _cache.rootFolderId);
    }
  }

  /**
   * Escribe un fichero JSON en la subcarpeta de menús.
   * @param {string} fileName - Ej: 'semana_2025-07-07.json'
   * @param {object} data
   * @returns {Promise<string>}
   */
  async function writeMenuJson(fileName, data) {
    const content = JSON.stringify(data, null, 2);
    const blob = new Blob([content], { type: 'application/json' });
    const existingId = await _getFileId(fileName, _cache.menusFolderId);

    if (existingId) return _updateFile(existingId, blob);
    return _createFile(fileName, blob, _cache.menusFolderId);
  }

  /**
   * Lista todos los ficheros JSON de la carpeta de menús.
   * @returns {Promise<Array<{ id, name, modifiedTime }>>}
   */
  async function listMenuFiles() {
    return _listFiles(_cache.menusFolderId, 'application/json');
  }

  /**
   * Lee un fichero JSON de la carpeta de menús.
   * @param {string} fileId
   * @returns {Promise<object>}
   */
  async function readMenuJson(fileId) {
    const token = Auth.getAccessToken();
    const res = await fetch(`${BASE_URL}/files/${fileId}?alt=media`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Error leyendo menú ${fileId}: ${res.status}`);
    return res.json();
  }

  /**
   * Verifica si algún fichero clave ha sido modificado externamente
   * (útil para el polling de sincronización).
   * @param {string} fileName
   * @returns {Promise<boolean>} - true si ha cambiado desde la última lectura
   */
  async function hasChanged(fileName) {
    const fileId = _cache.fileIds[fileName];
    if (!fileId) return false;

    const token = Auth.getAccessToken();
    const res = await fetch(`${BASE_URL}/files/${fileId}?fields=modifiedTime`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return false;

    const { modifiedTime } = await res.json();
    const lastKnown = _cache.etags[fileName];
    return modifiedTime !== lastKnown;
  }

  /**
   * Devuelve los IDs de las carpetas para uso por otros módulos.
   * @returns {{ rootFolderId, menusFolderId, comprasFolderId }}
   */
  function getFolderIds() {
    return {
      rootFolderId:    _cache.rootFolderId,
      menusFolderId:   _cache.menusFolderId,
      comprasFolderId: _cache.comprasFolderId,
    };
  }

  // ── Privados ─────────────────────────────────────────────────────

  /**
   * Obtiene el token de acceso o lanza un error si no hay sesión.
   * @returns {string}
   */
  function _token() {
    const t = Auth.getAccessToken();
    if (!t) throw new Error('Sin sesión activa. Por favor, vuelve a iniciar sesión.');
    return t;
  }

  /**
   * Asegura que existe una carpeta en Drive (la crea si no existe).
   * @param {string} name     - Nombre de la carpeta
   * @param {string} parentId - ID del padre ('root' o ID de carpeta)
   * @returns {Promise<string>} - ID de la carpeta
   */
  async function _ensureFolder(name, parentId) {
    // Busca si ya existe
    const q = `name='${name}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`;
    const token = _token();

    const res = await fetch(`${BASE_URL}/files?q=${encodeURIComponent(q)}&fields=files(id,name)`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Error buscando carpeta ${name}: ${res.status}`);

    const { files } = await res.json();
    if (files && files.length > 0) return files[0].id;

    // Crea la carpeta
    const createRes = await fetch(`${BASE_URL}/files`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentId],
      }),
    });
    if (!createRes.ok) throw new Error(`Error creando carpeta ${name}: ${createRes.status}`);
    const folder = await createRes.json();
    return folder.id;
  }

  /**
   * Obtiene el ID de un fichero por nombre dentro de una carpeta.
   * @param {string} fileName
   * @param {string} folderId
   * @returns {Promise<string|null>}
   */
  async function _getFileId(fileName, folderId) {
    // Caché en memoria
    if (_cache.fileIds[fileName]) return _cache.fileIds[fileName];

    const q = `name='${fileName}' and '${folderId}' in parents and trashed=false`;
    const token = _token();

    const res = await fetch(
      `${BASE_URL}/files?q=${encodeURIComponent(q)}&fields=files(id,name,modifiedTime)`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) return null;

    const { files } = await res.json();
    if (!files || files.length === 0) return null;

    const file = files[0];
    _cache.fileIds[fileName] = file.id;
    _cache.etags[fileName]   = file.modifiedTime;
    return file.id;
  }

  /**
   * Crea un fichero nuevo en Drive.
   * @param {string} name
   * @param {Blob}   blob
   * @param {string} parentId
   * @returns {Promise<string>} - ID del fichero creado
   */
  async function _createFile(name, blob, parentId) {
    const token = _token();
    const metadata = { name, parents: [parentId] };

    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', blob);

    const res = await fetch(`${UPLOAD_URL}/files?uploadType=multipart&fields=id,modifiedTime`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    if (!res.ok) throw new Error(`Error creando fichero ${name}: ${res.status}`);

    const file = await res.json();
    _cache.fileIds[name] = file.id;
    _cache.etags[name]   = file.modifiedTime;
    return file.id;
  }

  /**
   * Actualiza el contenido de un fichero existente.
   * @param {string} fileId
   * @param {Blob}   blob
   * @returns {Promise<string>} - ID del fichero
   */
  async function _updateFile(fileId, blob) {
    const token = _token();
    const res = await fetch(`${UPLOAD_URL}/files/${fileId}?uploadType=media&fields=id,modifiedTime`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': blob.type,
      },
      body: blob,
    });
    if (!res.ok) throw new Error(`Error actualizando fichero ${fileId}: ${res.status}`);

    const file = await res.json();
    // Actualiza el ETag local
    for (const [name, id] of Object.entries(_cache.fileIds)) {
      if (id === fileId) _cache.etags[name] = file.modifiedTime;
    }
    return file.id;
  }

  /**
   * Lista ficheros de una carpeta por tipo MIME.
   * @param {string} folderId
   * @param {string} mimeType
   * @returns {Promise<Array>}
   */
  async function _listFiles(folderId, mimeType) {
    if (!folderId) return [];
    const token = _token();
    const q = `'${folderId}' in parents and mimeType='${mimeType}' and trashed=false`;
    const res = await fetch(
      `${BASE_URL}/files?q=${encodeURIComponent(q)}&fields=files(id,name,modifiedTime)&orderBy=name desc`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) return [];
    const { files } = await res.json();
    return files || [];
  }

  /**
   * Actualiza el ETag local de un fichero tras leerlo.
   * @param {string} fileId
   * @param {string} fileName
   */
  async function _updateEtag(fileId, fileName) {
    try {
      const token = _token();
      const res = await fetch(`${BASE_URL}/files/${fileId}?fields=modifiedTime`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const { modifiedTime } = await res.json();
        _cache.etags[fileName] = modifiedTime;
      }
    } catch { /* no crítico */ }
  }

  // ── Export ───────────────────────────────────────────────────────
  return {
    initFolderStructure,
    readJson,
    writeJson,
    writeMenuJson,
    readMenuJson,
    listMenuFiles,
    hasChanged,
    getFolderIds,
  };

})();
