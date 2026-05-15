/**
 * Listening Hub API - Cloudflare Worker (零依赖版)
 * 可直接粘贴到 Cloudflare Dashboard 在线编辑器
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    // Handle preflight
    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    try {
      let response;

      if (path === '/api/health' && method === 'GET') {
        response = json({ status: 'ok', timestamp: Date.now() });
      } else if (path === '/api/login' && method === 'POST') {
        response = await handleLogin(request, env);
      } else if (path === '/api/verify' && method === 'POST') {
        response = await handleVerify(request, env);
      } else if (path === '/api/sync' && method === 'GET') {
        response = await handleSyncPull(request, env);
      } else if (path === '/api/sync' && method === 'POST') {
        response = await handleSyncPush(request, env);
      } else if (path === '/api/profile' && method === 'GET') {
        response = await handleProfile(request, env);
      } else {
        response = json({ error: 'Not found' }, 404);
      }

      // Attach CORS headers
      const newHeaders = new Headers(response.headers);
      Object.entries(corsHeaders).forEach(([k, v]) => newHeaders.set(k, v));
      return new Response(response.body, { status: response.status, headers: newHeaders });

    } catch (err) {
      return json({ error: err.message || 'Internal error' }, 500, corsHeaders);
    }
  }
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders }
  });
}

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function generateUUID() {
  return crypto.randomUUID();
}

// ─── JWT (简化实现，HMAC-SHA256) ─────────────────────────────────────────────

function base64url(buf) {
  const str = typeof buf === 'string' ? buf : new TextDecoder().decode(buf);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlEncode(obj) {
  return base64url(JSON.stringify(obj));
}

function base64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return JSON.parse(atob(str));
}

async function signJWT(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  payload.iat = now;
  payload.exp = now + 7 * 24 * 3600; // 7 days

  const headerB64 = base64urlEncode(header);
  const payloadB64 = base64urlEncode(payload);
  const signingInput = headerB64 + '.' + payloadB64;

  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signingInput));
  const sigB64 = base64url(new Uint8Array(sig));

  return signingInput + '.' + sigB64;
}

async function verifyJWT(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid token');

  const [headerB64, payloadB64, sigB64] = parts;
  const signingInput = headerB64 + '.' + payloadB64;

  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
  );

  // Decode signature
  let sigStr = sigB64.replace(/-/g, '+').replace(/_/g, '/');
  while (sigStr.length % 4) sigStr += '=';
  const sigBuf = Uint8Array.from(atob(sigStr), c => c.charCodeAt(0));

  const valid = await crypto.subtle.verify('HMAC', key, sigBuf, new TextEncoder().encode(signingInput));
  if (!valid) throw new Error('Invalid signature');

  const payload = base64urlDecode(payloadB64);
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('Token expired');
  }
  return payload;
}

async function requireAuth(request, env) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('未登录');
  }
  return await verifyJWT(authHeader.slice(7), env.JWT_SECRET);
}

// ─── Route Handlers ──────────────────────────────────────────────────────────

async function handleLogin(request, env) {
  const { email } = await request.json();
  if (!email || !email.includes('@')) {
    return json({ error: '请输入有效的邮箱地址' }, 400);
  }

  const db = env.DB;
  const code = generateCode();
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 300;

  await db.prepare('UPDATE verify_codes SET used = 1 WHERE email = ? AND used = 0').bind(email).run();
  await db.prepare('INSERT INTO verify_codes (email, code, expires_at) VALUES (?, ?, ?)').bind(email, code, expiresAt).run();

  return json({ message: '验证码已生成', code });
}

async function handleVerify(request, env) {
  const { email, code } = await request.json();
  if (!email || !code) {
    return json({ error: '邮箱和验证码不能为空' }, 400);
  }

  const db = env.DB;
  const now = Math.floor(Date.now() / 1000);

  const record = await db.prepare(
    'SELECT id FROM verify_codes WHERE email = ? AND code = ? AND used = 0 AND expires_at > ? ORDER BY id DESC LIMIT 1'
  ).bind(email, code, now).first();

  if (!record) {
    return json({ error: '验证码无效或已过期' }, 400);
  }

  await db.prepare('UPDATE verify_codes SET used = 1 WHERE id = ?').bind(record.id).run();

  let user = await db.prepare('SELECT id, email, nickname FROM users WHERE email = ?').bind(email).first();

  if (!user) {
    const userId = generateUUID();
    await db.prepare('INSERT INTO users (id, email, created_at, last_login_at) VALUES (?, ?, ?, ?)').bind(userId, email, now, now).run();
    await db.prepare('INSERT INTO user_data (user_id, data, version, updated_at) VALUES (?, ?, 1, ?)').bind(userId, '{}', now).run();
    user = { id: userId, email, nickname: '' };
  } else {
    await db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').bind(now, user.id).run();
  }

  const token = await signJWT({ userId: user.id, email: user.email }, env.JWT_SECRET);
  return json({ token, user: { id: user.id, email: user.email, nickname: user.nickname || '' } });
}

async function handleSyncPull(request, env) {
  const user = await requireAuth(request, env);
  const db = env.DB;

  const record = await db.prepare('SELECT data, version, updated_at FROM user_data WHERE user_id = ?').bind(user.userId).first();
  if (!record) {
    return json({ data: {}, version: 0, updatedAt: 0 });
  }

  let data = {};
  try { data = JSON.parse(record.data); } catch (e) {}
  return json({ data, version: record.version, updatedAt: record.updated_at });
}

async function handleSyncPush(request, env) {
  const user = await requireAuth(request, env);
  const { data, version } = await request.json();
  if (!data) return json({ error: '数据不能为空' }, 400);

  const db = env.DB;
  const now = Math.floor(Date.now() / 1000);

  const current = await db.prepare('SELECT version, data FROM user_data WHERE user_id = ?').bind(user.userId).first();

  if (!current) {
    await db.prepare('INSERT INTO user_data (user_id, data, version, updated_at) VALUES (?, ?, 1, ?)').bind(user.userId, JSON.stringify(data), now).run();
    return json({ success: true, version: 1 });
  }

  if (version && version < current.version) {
    let serverData = {};
    try { serverData = JSON.parse(current.data); } catch (e) {}
    return json({ success: false, conflict: true, serverData, serverVersion: current.version });
  }

  const newVersion = current.version + 1;
  await db.prepare('UPDATE user_data SET data = ?, version = ?, updated_at = ? WHERE user_id = ?').bind(JSON.stringify(data), newVersion, now, user.userId).run();
  return json({ success: true, version: newVersion });
}

async function handleProfile(request, env) {
  const user = await requireAuth(request, env);
  const db = env.DB;
  const row = await db.prepare('SELECT id, email, nickname, created_at, last_login_at FROM users WHERE id = ?').bind(user.userId).first();
  if (!row) return json({ error: '用户不存在' }, 404);
  return json({ user: row });
}
