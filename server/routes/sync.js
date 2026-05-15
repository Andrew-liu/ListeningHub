const express = require('express');
const { getDb } = require('../db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

/**
 * GET /api/sync
 * 拉取云端数据
 * Response: { data, version, updatedAt }
 */
router.get('/sync', authMiddleware, (req, res) => {
  const db = getDb();
  const record = db.prepare('SELECT data, version, updated_at FROM user_data WHERE user_id = ?').get(req.user.userId);

  if (!record) {
    return res.json({ data: {}, version: 0, updatedAt: 0 });
  }

  let data = {};
  try {
    data = JSON.parse(record.data);
  } catch (e) {
    data = {};
  }

  res.json({
    data,
    version: record.version,
    updatedAt: record.updated_at
  });
});

/**
 * POST /api/sync
 * 推送数据到云端
 * Body: { data, version }
 *   - data: { progress, vocabulary }
 *   - version: 客户端知道的版本号
 * Response: { success, version, conflict? }
 */
router.post('/sync', authMiddleware, (req, res) => {
  const { data, version } = req.body;

  if (!data) {
    return res.status(400).json({ error: '数据不能为空' });
  }

  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  // 获取当前云端版本
  const current = db.prepare('SELECT version, data FROM user_data WHERE user_id = ?').get(req.user.userId);

  if (!current) {
    // 首次同步，直接创建
    db.prepare('INSERT INTO user_data (user_id, data, version, updated_at) VALUES (?, ?, 1, ?)').run(
      req.user.userId, JSON.stringify(data), now
    );
    return res.json({ success: true, version: 1 });
  }

  // 冲突检测：如果客户端的版本小于服务端版本，说明有其他设备已更新
  if (version && version < current.version) {
    // 返回冲突标记和服务端数据，让客户端决定如何合并
    let serverData = {};
    try { serverData = JSON.parse(current.data); } catch (e) {}
    return res.json({
      success: false,
      conflict: true,
      serverData,
      serverVersion: current.version
    });
  }

  // 正常更新
  const newVersion = current.version + 1;
  db.prepare('UPDATE user_data SET data = ?, version = ?, updated_at = ? WHERE user_id = ?').run(
    JSON.stringify(data), newVersion, now, req.user.userId
  );

  res.json({ success: true, version: newVersion });
});

module.exports = router;
