import { Hono } from 'hono';
import { cors } from 'hono/cors';
import * as jose from 'jose';

const app = new Hono();

// CORS - 允许所有来源（GitHub Pages 等）
app.use('/*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

// ─── 工具函数 ───────────────────────────────────────────────────────────────

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function generateUUID() {
  return crypto.randomUUID();
}

async function signJWT(payload, secret) {
  const key = new TextEncoder().encode(secret);
  return await new jose.SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('7d')
    .setIssuedAt()
    .sign(key);
}

async function verifyJWT(token, secret) {
  const key = new TextEncoder().encode(secret);
  const { payload } = await jose.jwtVerify(token, key);
  return payload;
}

// ─── 认证中间件 ──────────────────────────────────────────────────────────────

async function authMiddleware(c, next) {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: '未登录，请先登录' }, 401);
  }
  const token = authHeader.slice(7);
  try {
    const payload = await verifyJWT(token, c.env.JWT_SECRET);
    c.set('user', payload);
    await next();
  } catch (err) {
    return c.json({ error: '登录已过期，请重新登录' }, 401);
  }
}

// ─── 路由 ────────────────────────────────────────────────────────────────────

// Health check
app.get('/api/health', (c) => {
  return c.json({ status: 'ok', timestamp: Date.now() });
});

// POST /api/login - 发送验证码
app.post('/api/login', async (c) => {
  const { email } = await c.req.json();
  if (!email || !email.includes('@')) {
    return c.json({ error: '请输入有效的邮箱地址' }, 400);
  }

  const db = c.env.DB;
  const code = generateCode();
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 300; // 5分钟

  // 清除旧验证码
  await db.prepare('UPDATE verify_codes SET used = 1 WHERE email = ? AND used = 0').bind(email).run();
  // 插入新验证码
  await db.prepare('INSERT INTO verify_codes (email, code, expires_at) VALUES (?, ?, ?)').bind(email, code, expiresAt).run();

  return c.json({ message: '验证码已生成', code });
});

// POST /api/verify - 验证码确认
app.post('/api/verify', async (c) => {
  const { email, code } = await c.req.json();
  if (!email || !code) {
    return c.json({ error: '邮箱和验证码不能为空' }, 400);
  }

  const db = c.env.DB;
  const now = Math.floor(Date.now() / 1000);

  // 查找有效验证码
  const record = await db.prepare(
    'SELECT id FROM verify_codes WHERE email = ? AND code = ? AND used = 0 AND expires_at > ? ORDER BY id DESC LIMIT 1'
  ).bind(email, code, now).first();

  if (!record) {
    return c.json({ error: '验证码无效或已过期' }, 400);
  }

  // 标记已使用
  await db.prepare('UPDATE verify_codes SET used = 1 WHERE id = ?').bind(record.id).run();

  // 查找或创建用户
  let user = await db.prepare('SELECT id, email, nickname FROM users WHERE email = ?').bind(email).first();

  if (!user) {
    const userId = generateUUID();
    await db.prepare('INSERT INTO users (id, email, created_at, last_login_at) VALUES (?, ?, ?, ?)').bind(userId, email, now, now).run();
    await db.prepare('INSERT INTO user_data (user_id, data, version, updated_at) VALUES (?, ?, 1, ?)').bind(userId, '{}', now).run();
    user = { id: userId, email, nickname: '' };
  } else {
    await db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').bind(now, user.id).run();
  }

  // 生成 JWT
  const token = await signJWT({ userId: user.id, email: user.email }, c.env.JWT_SECRET);

  return c.json({ token, user: { id: user.id, email: user.email, nickname: user.nickname || '' } });
});

// GET /api/sync - 拉取数据
app.get('/api/sync', authMiddleware, async (c) => {
  const db = c.env.DB;
  const user = c.get('user');

  const record = await db.prepare('SELECT data, version, updated_at FROM user_data WHERE user_id = ?').bind(user.userId).first();

  if (!record) {
    return c.json({ data: {}, version: 0, updatedAt: 0 });
  }

  let data = {};
  try { data = JSON.parse(record.data); } catch (e) {}

  return c.json({ data, version: record.version, updatedAt: record.updated_at });
});

// POST /api/sync - 推送数据
app.post('/api/sync', authMiddleware, async (c) => {
  const { data, version } = await c.req.json();
  if (!data) {
    return c.json({ error: '数据不能为空' }, 400);
  }

  const db = c.env.DB;
  const user = c.get('user');
  const now = Math.floor(Date.now() / 1000);

  const current = await db.prepare('SELECT version, data FROM user_data WHERE user_id = ?').bind(user.userId).first();

  if (!current) {
    await db.prepare('INSERT INTO user_data (user_id, data, version, updated_at) VALUES (?, ?, 1, ?)').bind(user.userId, JSON.stringify(data), now).run();
    return c.json({ success: true, version: 1 });
  }

  // 冲突检测
  if (version && version < current.version) {
    let serverData = {};
    try { serverData = JSON.parse(current.data); } catch (e) {}
    return c.json({ success: false, conflict: true, serverData, serverVersion: current.version });
  }

  // 正常更新
  const newVersion = current.version + 1;
  await db.prepare('UPDATE user_data SET data = ?, version = ?, updated_at = ? WHERE user_id = ?').bind(JSON.stringify(data), newVersion, now, user.userId).run();

  return c.json({ success: true, version: newVersion });
});

// GET /api/profile
app.get('/api/profile', authMiddleware, async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const row = await db.prepare('SELECT id, email, nickname, created_at, last_login_at FROM users WHERE id = ?').bind(user.userId).first();
  if (!row) return c.json({ error: '用户不存在' }, 404);
  return c.json({ user: row });
});

export default app;
