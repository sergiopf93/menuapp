/**
 * MenuApp — Módulo de autenticación
 * Gestiona la sesión del servidor; conserva Identity Services para GitHub Pages.
 *
 * IMPORTANTE: Sustituye GOOGLE_CLIENT_ID por tu Client ID real de Google Cloud Console.
 *
 * @module Auth
 */

const Auth = (() => {

  // ── Configuración ────────────────────────────────────────────────
  /**
   * ⚠ REEMPLAZA ESTE VALOR con tu Client ID de Google Cloud Console.
   * Lo obtienes en: console.cloud.google.com → APIs y servicios → Credenciales
   */
  const GOOGLE_CLIENT_ID = '239981851235-35btnur92qg9to032gtvn8guocodpfph.apps.googleusercontent.com';

  /**
   * Scopes necesarios:
   * - drive.file: acceso solo a ficheros creados por la app (más seguro que drive completo)
   */
  const SCOPES = 'https://www.googleapis.com/auth/drive.file openid email profile';

  let _accessToken = null;
  let _tokenExpiry = null;
  let _userInfo = null;
  let _tokenClient = null;
  let _initPromise = null;
  let _rejectLogin = null;
  const _serverAuth = globalThis.MENUAPP_SERVER_AUTH === true;
  let _refreshPromise = null;
  let _sessionVersion = 0;
  let _loggedOut = false;

  async function _serverRequest(path) {
    return fetch(path, {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'X-MenuApp-Request': '1' }, signal: AbortSignal.timeout(10000),
    });
  }

  async function ensureAccessToken() {
    if (!_serverAuth || getAccessToken()) return getAccessToken();
    if (_loggedOut || (typeof navigator !== 'undefined' && !navigator.onLine)) return null;
    if (_refreshPromise) return _refreshPromise;
    const version = _sessionVersion;
    _refreshPromise = (async () => {
      const response = await _serverRequest('/auth/session');
      if (version !== _sessionVersion) return null;
      if (response.status === 401) {
        _accessToken = null;
        _tokenExpiry = null;
        return null;
      }
      if (!response.ok) throw new Error('No se pudo renovar la conexión con Google. Se reintentará automáticamente.');
      const data = await response.json();
      if (version !== _sessionVersion) return null;
      if (!data.accessToken || !Number.isFinite(data.tokenExpiry) || data.tokenExpiry <= Date.now() + 60000 || !data.userInfo?.sub) {
        throw new Error('La sesión recibida no es válida.');
      }
      _accessToken = data.accessToken;
      _tokenExpiry = data.tokenExpiry;
      _userInfo = data.userInfo;
      // Persiste únicamente el perfil; los tokens de servidor no se guardan en IndexedDB.
      await Storage.set('auth_session', { userInfo: _userInfo });
      return _accessToken;
    })().finally(() => { _refreshPromise = null; });
    return _refreshPromise;
  }

  function usesServerSession() { return _serverAuth; }

  // ── API pública ──────────────────────────────────────────────────

  /**
   * Inicializa el cliente de OAuth de Google.
   * Debe llamarse una vez al arrancar la app, después de que el SDK de Google
   * haya cargado (gsi/client).
   * @returns {Promise<void>}
   */
  async function init() {
    if (_serverAuth) return;
    if (_tokenClient) return;
    if (_initPromise) return _initPromise;
    _initPromise = new Promise((resolve, reject) => {
      // Carga el SDK de Google Identity Services dinámicamente
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.onload = () => {
        try {
          _tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: GOOGLE_CLIENT_ID,
            scope: SCOPES,
            callback: _handleTokenResponse,
            error_callback: error => {
              const rejectLogin = _rejectLogin;
              _rejectLogin = null;
              rejectLogin?.(new Error(error.type === 'popup_closed'
                ? 'Se ha cerrado la conexión con Google.'
                : 'No se pudo abrir la conexión con Google. Vuelve a pulsar Conectar.'));
            },
          });
          resolve();
        } catch (err) {
          reject(new Error(`Error inicializando Google OAuth: ${err.message}`));
        }
      };
      script.onerror = () => reject(new Error('No se pudo cargar el SDK de Google Identity Services'));
      document.head.appendChild(script);
    }).catch(err => {
      _initPromise = null;
      throw err;
    });
    return _initPromise;
  }

  /**
   * Intenta restaurar una sesión previa desde IndexedDB.
   * Si existe un token válido, lo restaura y devuelve true.
   * @returns {Promise<boolean>}
   */
  async function tryRestoreSession() {
    try {
      const stored = await Storage.get('auth_session');
      if (!stored) return false;

      const { accessToken, tokenExpiry, userInfo } = stored;
      _userInfo = userInfo || null;
      if (_serverAuth) return false;
      if (!accessToken || !tokenExpiry) return false;

      // Conserva el perfil para usar la app localmente aunque toque reconectar.
      const expiresIn = tokenExpiry - Date.now();
      if (expiresIn < 60_000) return false;

      _accessToken = accessToken;
      _tokenExpiry = tokenExpiry;
      _userInfo = userInfo;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Lanza el flujo de login con Google.
   * Si ya hay un token almacenado, intenta usarlo sin popup.
   * @returns {Promise<void>}
   */
  async function login() {
    if (_serverAuth) {
      _loggedOut = false;
      if (await ensureAccessToken()) return true;
      const form = document.createElement('form');
      form.method = 'POST';
      form.action = '/auth/login';
      document.body.appendChild(form);
      form.submit();
      return false; // La navegación termina esta sesión de la página.
    }
    if (!_tokenClient) throw new Error('Auth no inicializado. Llama a Auth.init() primero.');

    return new Promise((resolve, reject) => {
      _rejectLogin = reject;
      // Sobrescribe el callback para esta llamada concreta
      _tokenClient.callback = async (response) => {
        try {
          await _handleTokenResponse(response);
          resolve();
        } catch (err) {
          reject(err);
        } finally {
          _rejectLogin = null;
        }
      };

      // Reutiliza el consentimiento previo; el flujo del navegador sigue requiriendo interacción.
      _tokenClient.requestAccessToken({ prompt: '' });
    });
  }

  /**
   * Cierra la sesión del usuario.
   * Invalida la sesión del dispositivo; en modo estático revoca el token de Google.
   * @returns {Promise<void>}
   */
  async function logout() {
    if (_serverAuth) {
      _sessionVersion++;
      _loggedOut = true;
      try {
        const response = await _serverRequest('/auth/logout');
        if (!response.ok) throw new Error('No se pudo cerrar la sesión. Vuelve a intentarlo con conexión.');
      } catch (err) {
        _loggedOut = false;
        throw err;
      }
      _accessToken = null;
      _tokenExpiry = null;
      _userInfo = null;
      await Storage.remove('auth_session');
      return;
    }
    if (_accessToken && typeof google !== 'undefined') {
      google.accounts?.oauth2?.revoke(_accessToken, () => {});
    }
    _accessToken = null;
    _tokenExpiry = null;
    _userInfo = null;
    await Storage.remove('auth_session');
  }

  /**
   * Devuelve el access token actual o null si no hay sesión activa.
   * @returns {string|null}
   */
  function getAccessToken() {
    if (!_accessToken) return null;
    if (_tokenExpiry && Date.now() > _tokenExpiry - 60_000) return null; // caducado
    return _accessToken;
  }

  /**
   * Devuelve la información del usuario autenticado.
   * @returns {{ name: string, email: string, picture: string }|null}
   */
  function getUserInfo() {
    return _userInfo;
  }

  /**
   * Indica si el usuario tiene una sesión activa y válida.
   * @returns {boolean}
   */
  function isAuthenticated() {
    return !!getAccessToken();
  }

  // ── Privados ─────────────────────────────────────────────────────

  /**
   * Callback que procesa la respuesta del flujo OAuth.
   * @param {object} response - Respuesta de Google con access_token o error.
   */
  async function _handleTokenResponse(response) {
    if (response.error) {
      throw new Error(`Error OAuth: ${response.error} — ${response.error_description || ''}`);
    }

    _accessToken = response.access_token;
    // Los tokens de Google suelen durar 3600s; usamos ese valor si no viene expires_in
    const expiresIn = (response.expires_in || 3600) * 1000;
    _tokenExpiry = Date.now() + expiresIn;

    // Obtiene info del usuario para mostrar en la UI
    _userInfo = await _fetchUserInfo(_accessToken);

    // Persiste la sesión en IndexedDB
    await Storage.set('auth_session', {
      accessToken: _accessToken,
      tokenExpiry: _tokenExpiry,
      userInfo: _userInfo,
    });
  }

  /**
   * Obtiene el perfil del usuario autenticado desde la API de Google.
   * @param {string} token
   * @returns {Promise<{ name: string, email: string, picture: string }>}
   */
  async function _fetchUserInfo(token) {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('No se pudo obtener la información del usuario');
    return res.json();
  }

  // ── Export ───────────────────────────────────────────────────────
  return { init, tryRestoreSession, login, logout, getAccessToken, getUserInfo, isAuthenticated, ensureAccessToken, usesServerSession };

})();
