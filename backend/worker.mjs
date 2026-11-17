const SESSION = '__Host-menuapp-session';
const FLOW = '__Host-menuapp-oauth';
const LIFETIME = 90 * 86400;
const SCOPES = 'https://www.googleapis.com/auth/drive.file openid email profile';
const encoder = new TextEncoder();
const noStore = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };
const random = () => base64(crypto.getRandomValues(new Uint8Array(32)));
function base64(bytes) { return btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/, ''); }
function bytes(value) { return Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')), c => c.charCodeAt(0)); }
async function hash(value) { return base64(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))); }
function cookie(name, value, age) { return `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${age}`; }
function readCookie(request, name) {
  const value = (request.headers.get('Cookie') || '').split(';').map(s => s.trim()).find(s => s.startsWith(name + '='))?.slice(name.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(value || '') ? value : null;
}
function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...noStore, 'Content-Type': 'application/json', ...headers } });
}
function redirect(url, cookies = []) {
  const headers = new Headers({ ...noStore, Location: url });
  cookies.forEach(c => headers.append('Set-Cookie', c));
  return new Response(null, { status: 303, headers });
}
async function key(env) {
  const raw = bytes(env.SESSION_ENCRYPTION_KEY);
  if (raw.length !== 32) throw new Error('Invalid encryption key');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt','decrypt']);
}
async function seal(env, data, id) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(id) }, await key(env), encoder.encode(JSON.stringify(data)));
  return `${base64(iv)}.${base64(new Uint8Array(ciphertext))}`;
}
async function unseal(env, value, id) {
  const [iv, ciphertext] = value.split('.');
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(iv), additionalData: encoder.encode(id) }, await key(env), bytes(ciphertext));
  return JSON.parse(new TextDecoder().decode(plaintext));
}
const ready = env => !!(env.DB && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.SESSION_ENCRYPTION_KEY && env.APP_ORIGIN);
async function tokenRequest(env, params, fetcher) {
  const response = await fetcher('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, ...params }),
    signal: AbortSignal.timeout(10000),
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) {
    const error = new Error('Google authorization failed');
    error.revoked = data.error === 'invalid_grant';
    throw error;
  }
  if (data.scope && !data.scope.split(' ').includes('https://www.googleapis.com/auth/drive.file')) throw new Error('Drive permission missing');
  return data;
}
async function start(request, env) {
  // A same-origin form POST prevents unsolicited login/account-switch navigation.
  const nonce = random(), id = await hash(nonce), state = random(), verifier = random();
  await env.DB.prepare('INSERT INTO oauth_flows (id,payload,expires_at) VALUES (?,?,?)')
    .bind(id, await seal(env, { state, verifier }, id), Date.now() + 600000).run();
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: env.APP_ORIGIN + '/auth/callback', response_type: 'code', scope: SCOPES,
    access_type: 'offline', prompt: 'consent', state,
    code_challenge: await hash(verifier), code_challenge_method: 'S256',
  }).toString();
  return redirect(url.href, [cookie(FLOW, nonce, 600)]);
}
async function callback(request, env, fetcher) {
  const url = new URL(request.url), nonce = readCookie(request, FLOW);
  if (!nonce) return json({ error: 'invalid_oauth_state' }, 400);
  const id = await hash(nonce);
  const flow = await env.DB.prepare('SELECT * FROM oauth_flows WHERE id = ?').bind(id).first();
  if (!flow || flow.expires_at <= Date.now()) return json({ error: 'expired_oauth_state' }, 400);
  const data = await unseal(env, flow.payload, id);
  if (!url.searchParams.get('state') || url.searchParams.get('state') !== data.state) return json({ error: 'invalid_oauth_state' }, 400);
  // Atomic consume: a callback cannot exchange the same authorization twice.
  const consumed = await env.DB.prepare('DELETE FROM oauth_flows WHERE id = ? RETURNING id').bind(id).first();
  if (!consumed) return json({ error: 'used_oauth_state' }, 400);
  const clearFlow = cookie(FLOW, '', 0);
  if (url.searchParams.has('error')) return redirect('/?auth_error=cancelled', [clearFlow]);
  try {
    const code = url.searchParams.get('code');
    if (!code) throw new Error('Missing code');
    const tokens = await tokenRequest(env, { grant_type: 'authorization_code', code,
      redirect_uri: env.APP_ORIGIN + '/auth/callback', code_verifier: data.verifier }, fetcher);
    if (!tokens.refresh_token) throw new Error('Offline authorization missing');
    const profileResponse = await fetcher('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` }, signal: AbortSignal.timeout(10000),
    });
    if (!profileResponse.ok) throw new Error('Profile unavailable');
    const profile = await profileResponse.json();
    if (!profile.sub) throw new Error('Invalid profile');
    const session = random(), sessionId = await hash(session);
    const userInfo = { sub: profile.sub, name: profile.name || '', email: profile.email || '', picture: profile.picture || '' };
    const payload = await seal(env, { refreshToken: tokens.refresh_token, accessToken: tokens.access_token,
      tokenExpiry: Date.now() + Number(tokens.expires_in || 3600) * 1000, userInfo }, sessionId);
    await env.DB.prepare('INSERT INTO auth_sessions (id,payload,expires_at) VALUES (?,?,?)')
      .bind(sessionId, payload, Date.now() + LIFETIME * 1000).run();
    const previous = readCookie(request, SESSION);
    if (previous) await env.DB.prepare('DELETE FROM auth_sessions WHERE id = ?').bind(await hash(previous)).run();
    return redirect('/', [clearFlow, cookie(SESSION, session, LIFETIME)]);
  } catch {
    return redirect('/?auth_error=connection', [clearFlow]);
  }
}
async function session(request, env, fetcher) {
  const nonce = readCookie(request, SESSION);
  if (!nonce) return json({ error: 'login_required' }, 401);
  const id = await hash(nonce);
  const row = await env.DB.prepare('SELECT * FROM auth_sessions WHERE id = ?').bind(id).first();
  if (!row || row.expires_at <= Date.now()) {
    if (row) await env.DB.prepare('DELETE FROM auth_sessions WHERE id = ?').bind(id).run();
    return json({ error: 'login_required' }, 401, { 'Set-Cookie': cookie(SESSION, '', 0) });
  }
  let data = await unseal(env, row.payload, id);
  if (data.tokenExpiry <= Date.now() + 120000) {
    try {
      const tokens = await tokenRequest(env, { grant_type: 'refresh_token', refresh_token: data.refreshToken }, fetcher);
      data = { ...data, accessToken: tokens.access_token, refreshToken: tokens.refresh_token || data.refreshToken,
        tokenExpiry: Date.now() + Number(tokens.expires_in || 3600) * 1000 };
      // UPDATE never resurrects a session deleted by logout while Google was responding.
      const updated = await env.DB.prepare('UPDATE auth_sessions SET payload = ? WHERE id = ? RETURNING id')
        .bind(await seal(env, data, id), id).first();
      if (!updated) return json({ error: 'login_required' }, 401);
    } catch (error) {
      if (!error.revoked) return json({ error: 'temporarily_unavailable' }, 503);
      await env.DB.prepare('DELETE FROM auth_sessions WHERE id = ?').bind(id).run();
      return json({ error: 'login_required' }, 401, { 'Set-Cookie': cookie(SESSION, '', 0) });
    }
  }
  // Only the short-lived access token reaches JS; renewal credentials remain encrypted in D1.
  return json({ accessToken: data.accessToken, tokenExpiry: data.tokenExpiry, userInfo: data.userInfo });
}
export async function handle(request, env, fetcher = fetch) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/auth/')) return env.ASSETS.fetch(request);
  if (!ready(env)) return json({ error: 'auth_not_configured' }, 503);
  if (url.origin !== env.APP_ORIGIN) return json({ error: 'invalid_host' }, 403);
  if (url.pathname === '/auth/callback' && request.method === 'GET') return callback(request, env, fetcher);
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
  if (request.headers.get('Origin') !== env.APP_ORIGIN || request.headers.get('Sec-Fetch-Site') === 'cross-site') return json({ error: 'invalid_origin' }, 403);
  if (url.pathname === '/auth/login') return start(request, env);
  if (request.headers.get('X-MenuApp-Request') !== '1') return json({ error: 'invalid_request' }, 403);
  if (url.pathname === '/auth/session') return session(request, env, fetcher);
  if (url.pathname === '/auth/logout') {
    const nonce = readCookie(request, SESSION);
    if (nonce) await env.DB.prepare('DELETE FROM auth_sessions WHERE id = ?').bind(await hash(nonce)).run();
    return json({ ok: true }, 200, { 'Set-Cookie': cookie(SESSION, '', 0) });
  }
  return json({ error: 'not_found' }, 404);
}
export default {
  async fetch(request, env) {
    try { return await handle(request, env); }
    catch { return json({ error: 'temporarily_unavailable' }, 503); }
  },
  async scheduled(event, env) {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM oauth_flows WHERE expires_at <= ?').bind(Date.now()),
      env.DB.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').bind(Date.now()),
    ]);
  },
};
