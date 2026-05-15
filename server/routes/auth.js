const express = require('express');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db');
const { JWT_SECRET, authMiddleware } = require('../middleware/auth');

const router = express.Router();

// 生成6位数字验证码
function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/**
 * POST /api/login
 * 发送验证码（注册和登录合一）
 * Body: { email }
 * Response: { message, code } (code 直接返回，简化模式)
 */
router.post('/login', (req, res) => {
  const { email } = req.body;

  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: '请输入有效的邮箱地址' });
  }

  const db = getDb();
  const code = generateCode();
  const expiresAt = Math.floor(Date.now() / 1000) + 300; // 5分钟有效

  // 清除该邮箱旧的未使用验证码
  db.prepare('UPDATE verify_codes SET used = 1 WHERE email = ? AND used = 0').run(email);

  // 插入新验证码
  db.prepare('INSERT INTO verify_codes (email, code, expires_at) VALUES (?, ?, ?)').run(email, code, expiresAt);

  res.json({
    message: '验证码已生成',
    code: code // 直接返回验证码（简化模式，小范围使用）
  });
});

/**
 * POST /api/verify
 * 验证码确认，返回 JWT token
 * Body: { email, code }
 * Response: { token, user }
 */
router.post('/verify', (req, res) => {
  const { email, code } = req.body;

  if (!email || !code) {
    return res.status(400).json({ error: '邮箱和验证码不能为空' });
  }

  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  // 查找有效验证码
  const record = db.prepare(
    'SELECT * FROM verify_codes WHERE email = ? AND code = ? AND used = 0 AND expires_at > ? ORDER BY id DESC LIMIT 1'
  ).get(email, code, now);

  if (!record) {
    return res.status(400).json({ error: '验证码无效或已过期' });
  }

  // 标记验证码已使用
  db.prepare('UPDATE verify_codes SET used = 1 WHERE id = ?').run(record.id);

  // 查找或创建用户
  let user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

  if (!user) {
    const userId = uuidv4();
    db.prepare('INSERT INTO users (id, email, created_at, last_login_at) VALUES (?, ?, ?, ?)').run(userId, email, now, now);
    // 初始化用户数据
    db.prepare('INSERT INTO user_data (user_id, data, version) VALUES (?, ?, 1)').run(userId, '{}');
    user = { id: userId, email, nickname: '', created_at: now };
  } else {
    db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now, user.id);
  }

  // 生成 JWT（7天有效）
  const token = jwt.sign(
    { userId: user.id, email: user.email },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      nickname: user.nickname || ''
    }
  });
});

/**
 * GET /api/profile
 * 获取当前用户信息
 */
router.get('/profile', authMiddleware, (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT id, email, nickname, created_at, last_login_at FROM users WHERE id = ?').get(req.user.userId);

  if (!user) {
    return res.status(404).json({ error: '用户不存在' });
  }

  res.json({ user });
});

/**
 * POST /api/logout
 * 前端清除 token 即可，后端无需操作（JWT 无状态）
 */
router.post('/logout', (req, res) => {
  res.json({ message: '已退出登录' });
});

module.exports = router;
