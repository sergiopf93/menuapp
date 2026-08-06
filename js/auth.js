/**
 * MenuApp — Módulo de autenticación
 * Gestiona el flujo OAuth 2.0 con Google usando el Identity Services SDK.
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
  const SCOPES = 'https://www.googleapis.com/auth/drive.file';

  let _accessToken = null;
  let _tokenExpiry = null;
  let _userInfo = null;
  let _tokenClient = null;

  // ── API pública ──────────────────────────────────────────────────

  /**
   * Inicializa el cliente de OAuth de Google.
   * Debe llamarse una vez al arrancar la app, después de que el SDK de Google
   * haya cargado (gsi/client).
   * @returns {Promise<void>}
   */
  async function init() {
    return new Promise((resolve, reject) => {
      // Carga el SDK de Google Identity Services dinámicamente
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.onload = () => {
        try {
          _tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: GOOGLE_CLIENT_ID,
            scope: SCOPES,
            callback: _handleTokenResponse,
          });
          resolve();
        } catch (err) {
          reject(new Error(`Error inicializando Google OAuth: ${err.message}`));
        }
      };
      script.onerror = () => reject(new Error('No se pudo cargar el SDK de Google Identity Services'));
      document.head.appendChild(script);
    });
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
      if (!accessToken || !tokenExpiry) return false;

      // Comprueba que el token no haya expirado (con 5 min de margen)
      const expiresIn = tokenExpiry - Date.now();
      if (expiresIn < 5 * 60 * 1000) {
        await Storage.remove('auth_session');
        return false;
      }

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
    if (!_tokenClient) throw new Error('Auth no inicializado. Llama a Auth.init() primero.');

    return new Promise((resolve, reject) => {
      // Sobrescribe el callback para esta llamada concreta
      _tokenClient.callback = async (response) => {
        try {
          await _handleTokenResponse(response);
          resolve();
        } catch (err) {
          reject(err);
        }
      };

      // prompt: '' = sin popup si ya hay sesión; 'consent' = fuerza selección de cuenta
      _tokenClient.requestAccessToken({ prompt: '' });
    });
  }

  /**
   * Cierra la sesión del usuario.
   * Revoca el token en Google y limpia el estado local.
   * @returns {Promise<void>}
   */
  async function logout() {
    if (_accessToken) {
      google.accounts.oauth2.revoke(_accessToken, () => {});
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
  return { init, tryRestoreSession, login, logout, getAccessToken, getUserInfo, isAuthenticated };

})();
