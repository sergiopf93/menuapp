const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const { webcrypto } = require('node:crypto');
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const origin = 'https://menuapp.example.com';
const secureKey = Buffer.alloc(32, 7).toString('base64url');
const scopes = 'https://www.googleapis.com/auth/drive.file openid email profile';
function setup() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(fs.readFileSync(require('node:path').join(__dirname, '../backend/migrations/0001_sessions.sql'), 'utf8'));
  const DB = {
    prepare(sql) {
      return { bind(...values) { return {
        async first() { return sqlite.prepare(sql).get(...values) || null; },
        async run() { return sqlite.prepare(sql).run(...values); },
      }; } };
    },
    async batch(statements) { return Promise.all(statements.map(s => s.run())); },
  };
  const calls = [];
  let refreshError = null, expiresIn = 3600;
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/userinfo')) return Response.json({ sub: 'google-user', name: 'Ana', email: 'ana@example.com' });
    const grant = options.body.get('grant_type');
    if (grant === 'refresh_token' && refreshError) return Response.json({ error: refreshError }, { status: 400 });
    return Response.json({ access_token: grant === 'refresh_token' ? 'renewed-access' : 'first-access',
      refresh_token: 'secret-refresh-token', expires_in: expiresIn, scope: scopes });
  };
  const env = { DB, APP_ORIGIN: origin, GOOGLE_CLIENT_ID: 'client', GOOGLE_CLIENT_SECRET: 'secret-client',
    SESSION_ENCRYPTION_KEY: secureKey, ASSETS: { fetch: async () => new Response('asset') } };
  const request = (path, cookie, extra = {}) => new Request(origin + path, {
    method: 'POST', headers: { Origin: origin, 'X-MenuApp-Request': '1', ...(cookie ? { Cookie: cookie } : {}), ...extra },
  });
  const call = async req => (await import('../backend/worker.mjs')).handle(req, env, fetcher);
  const start = async () => {
    const result = await call(request('/auth/login'));
    assert.equal(result.status, 303);
    const location = new URL(result.headers.get('Location'));
    const cookie = result.headers.get('Set-Cookie').split(';')[0];
    return { location, cookie, state: location.searchParams.get('state') };
  };
  const finish = async flow => call(new Request(origin + '/auth/callback?code=one-use-code&state=' + flow.state, { headers: { Cookie: flow.cookie } }));
  const login = async () => {
    const result = await finish(await start());
    assert.equal(result.status, 303);
    assert.equal(result.headers.get('Location'), '/');
    const cookie = result.headers.getSetCookie().find(c => c.startsWith('__Host-menuapp-session=')).split(';')[0];
    return { cookie, result };
  };
  return { sqlite, env, calls, call, request, start, finish, login, expires: n => { expiresIn = n; }, failRefresh: e => { refreshError = e; } };
}

test('OAuth usa state ligado al navegador, PKCE y acceso offline; cookies HttpOnly y tokens cifrados', async () => {
  const h = setup();
  const flow = await h.start();
  assert.equal(flow.location.searchParams.get('access_type'), 'offline');
  assert.equal(flow.location.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(flow.location.searchParams.get('redirect_uri'), origin + '/auth/callback');
  assert.equal(flow.location.searchParams.get('scope'), scopes);
  const done = await h.finish(flow);
  const cookies = done.headers.getSetCookie();
  assert(cookies.every(c => c.includes('Secure') && c.includes('HttpOnly') && c.includes('SameSite=Lax')));
  const row = h.sqlite.prepare('SELECT * FROM auth_sessions').get();
  assert(!row.payload.includes('secret-refresh-token'));
  assert(!row.payload.includes('first-access'));
  assert(!row.payload.includes('ana@example.com'));
  assert(!cookies.join('').includes(row.id));
  assert.equal(h.calls[0].options.body.get('code_verifier').length, 43);
  assert.equal(done.headers.get('Cache-Control'), 'no-store');
  assert.equal(done.headers.get('Referrer-Policy'), 'no-referrer');
});

test('restaura sin consentimiento repetido y no devuelve refresh token ni secreto', async () => {
  const h = setup();
  const { cookie } = await h.login();
  const res = await h.call(h.request('/auth/session', cookie));
  const body = await res.json();
  assert.equal(body.accessToken, 'first-access');
  assert.equal(body.userInfo.sub, 'google-user');
  assert.equal(JSON.stringify(body).includes('secret'), false);
  assert.equal(h.calls.length, 2);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
});

test('renueva automáticamente un token caducado con la credencial del servidor', async () => {
  const h = setup(); h.expires(1);
  const { cookie } = await h.login(); h.expires(3600);
  const res = await h.call(h.request('/auth/session', cookie));
  assert.equal((await res.json()).accessToken, 'renewed-access');
  assert.equal(h.calls.at(-1).options.body.get('grant_type'), 'refresh_token');
  assert.equal(h.calls.at(-1).options.body.get('refresh_token'), 'secret-refresh-token');
  assert.equal(h.sqlite.prepare('SELECT count(*) AS n FROM auth_sessions').get().n, 1);
});

test('rechaza callback sin cookie, con state cambiado, caducado y reutilizado', async () => {
  const h = setup(), flow = await h.start();
  assert.equal((await h.call(new Request(origin + '/auth/callback?code=x&state=' + flow.state))).status, 400);
  assert.equal((await h.finish({ ...flow, state: 'attacker' })).status, 400);
  assert.equal(h.calls.length, 0);
  await h.finish(flow);
  assert.equal((await h.finish(flow)).status, 400);
  const next = await h.start();
  h.sqlite.prepare('UPDATE oauth_flows SET expires_at = 0').run();
  assert.equal((await h.finish(next)).status, 400);
});

test('protege endpoints contra CSRF, origen ajeno y GET; no ofrece CORS', async () => {
  const h = setup();
  for (const path of ['/auth/login','/auth/session','/auth/logout']) {
    assert.equal((await h.call(new Request(origin + path))).status, 405);
    const res = await h.call(h.request(path, null, { Origin: 'https://evil.example' }));
    assert.equal(res.status, 403);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), null);
    assert.equal((await h.call(h.request(path, null, { Origin: 'null' }))).status, 403);
  }
  assert.equal((await h.call(h.request('/auth/session', null, { 'X-MenuApp-Request': '' }))).status, 403);
});

test('invalid_grant invalida la sesión, pero errores temporales conservan la renovación', async () => {
  for (const [error, status, rows] of [['invalid_grant',401,0],['temporarily_unavailable',503,1]]) {
    const h = setup(); h.expires(1);
    const { cookie } = await h.login(); h.failRefresh(error);
    const res = await h.call(h.request('/auth/session', cookie));
    assert.equal(res.status, status);
    assert.equal(h.sqlite.prepare('SELECT count(*) AS n FROM auth_sessions').get().n, rows);
  }
});

test('logout invalida solo el dispositivo, sin revocar otras sesiones', async () => {
  const h = setup(), a = await h.login(), b = await h.login();
  const res = await h.call(h.request('/auth/logout', a.cookie));
  assert.equal(res.status, 200);
  assert(res.headers.get('Set-Cookie').includes('Max-Age=0'));
  assert.equal((await h.call(h.request('/auth/session', a.cookie))).status, 401);
  assert.equal((await h.call(h.request('/auth/session', b.cookie))).status, 200);
});

test('sesión caducada, cookie inventada y datos cifrados manipulados no dan acceso', async () => {
  const h = setup(), { cookie } = await h.login();
  assert.equal((await h.call(h.request('/auth/session', '__Host-menuapp-session=' + 'a'.repeat(43)))).status, 401);
  h.sqlite.prepare('UPDATE auth_sessions SET expires_at = 0').run();
  assert.equal((await h.call(h.request('/auth/session', cookie))).status, 401);
  const b = await h.login();
  h.sqlite.prepare("UPDATE auth_sessions SET payload = 'invalid' ").run();
  await assert.rejects(h.call(h.request('/auth/session', b.cookie)));
});

test('cancelar Google vuelve a Inicio con error seguro y sin sesión', async () => {
  const h = setup(), flow = await h.start();
  const res = await h.call(new Request(origin + '/auth/callback?error=access_denied&state=' + flow.state, { headers: { Cookie: flow.cookie } }));
  assert.equal(res.headers.get('Location'), '/?auth_error=cancelled');
  assert.equal(h.sqlite.prepare('SELECT count(*) AS n FROM auth_sessions').get().n, 0);
});

test('sin configuración rechaza OAuth y mantiene los recursos estáticos', async () => {
  const h = setup(); delete h.env.GOOGLE_CLIENT_SECRET;
  assert.equal((await h.call(h.request('/auth/session'))).status, 503);
  assert.equal(await (await h.call(new Request(origin + '/'))).text(), 'asset');
});
