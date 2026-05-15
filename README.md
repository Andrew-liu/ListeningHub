<div align="center">

# 🎧 Listening Hub

### *沉浸式英语听力练习平台*

**100篇精选听力材料 · 逐句精听 · 中英对照 · 智能生词本 · 云端同步 · 勋章成就**

<p>
  <img alt="Vue" src="https://img.shields.io/badge/Vue-3.x-42b883?style=flat-square&logo=vue.js&logoColor=white" />
  <img alt="Tailwind" src="https://img.shields.io/badge/Tailwind-3.x-38bdf8?style=flat-square&logo=tailwindcss&logoColor=white" />
  <img alt="Cloudflare" src="https://img.shields.io/badge/Cloudflare-Workers-f38020?style=flat-square&logo=cloudflare&logoColor=white" />
  <img alt="PWA" src="https://img.shields.io/badge/PWA-Offline-blueviolet?style=flat-square" />
</p>

</div>

---

## 功能特性

| 功能 | 说明 |
|------|------|
| 🎯 **逐句精听** | 100 篇听力材料，每篇 16-17 句，支持单句/整集播放 |
| 🌐 **中英对照** | 每句配有中文翻译，一键切换显示/隐藏 |
| 📚 **智能生词本** | 点击任意单词查词典、收藏，支持 SRS 间隔复习 |
| 🏅 **勋章成就** | 15 枚成就勋章，覆盖打卡、听力、词汇等维度 |
| ☁️ **云端同步** | 登录后数据自动同步，跨设备无缝衔接 |
| 📝 **听写模式** | 听后默写，自动对比原文 |
| 🎙️ **跟读录音** | 录制发音与原文对比 |
| 🎨 **三色主题** | 明亮 / 复古 / 暗黑，护眼阅读 |
| 📱 **PWA 离线** | 可安装到桌面，无网也能用 |
| 🏷️ **20 分类** | Health、Science、Technology、History 等，每类 5 篇 |

## 架构

```
┌─────────────────────────────────────────┐
│  前端（GitHub Pages 纯静态）              │
│  Vue 3 CDN + Tailwind CSS + Web Speech  │
│  离线优先：localStorage 作为主存储        │
└────────────────┬────────────────────────┘
                 │ HTTPS (fetch)
┌────────────────▼────────────────────────┐
│  后端（Cloudflare Workers + D1）         │
│  认证：邮箱 + 验证码 → JWT              │
│  同步：JSON blob per user               │
│  免费额度足够个人/小范围使用              │
└─────────────────────────────────────────┘
```

## 快速开始

### 在线访问

直接打开 GitHub Pages 地址即可使用，无需安装。

### 本地开发

```bash
# 前端（零依赖，无需 npm）
python3 -m http.server 8080
# 打开 http://localhost:8080

# 后端（可选，用于本地测试同步功能）
cd server
npm install
node index.js
# API 运行在 http://localhost:3000
```

### Docker 部署（自托管）

```bash
docker compose up -d
# 访问 http://localhost:28080
```

## 部署说明

### 前端 → GitHub Pages

项目根目录的静态文件直接推送到 GitHub 即可：
- `index.html` / `app.js` / `sync.js` / `data/` / `manifest.json` / `service-worker.js`

### 后端 → Cloudflare Workers

```bash
cd worker
npm install
npx wrangler d1 create listening-hub-db
# 将 database_id 填入 wrangler.toml
npx wrangler d1 execute listening-hub-db --remote --file=schema.sql
npx wrangler deploy
```

部署后在 `index.html` 中配置 Worker 地址：
```html
<script>window.API_BASE = 'https://your-worker.workers.dev/api';</script>
```

### 后端 → Docker 自部署（备选）

不用 Cloudflare 也行，`docker-compose.yml` 包含前后端：
- 前端：nginx 容器
- 后端：Node.js + SQLite 容器
- nginx 反代 `/api/` 到后端

## 项目结构

```
├── index.html          # 主页面（Vue 3 SPA）
├── app.js              # 业务逻辑
├── sync.js             # 云端同步模块
├── data/episodes.js    # 100 篇听力材料数据
├── manifest.json       # PWA 配置
├── service-worker.js   # 离线缓存
├── server/             # Node.js 后端（Docker 自部署用）
│   ├── index.js
│   ├── db.js
│   ├── routes/
│   └── Dockerfile
├── worker/             # Cloudflare Worker 后端
│   ├── src/
│   │   ├── index.js          # Hono 版本（wrangler 部署）
│   │   └── worker-inline.js  # 零依赖版（网页编辑器粘贴）
│   ├── schema.sql
│   └── wrangler.toml
├── docker-compose.yml
├── Dockerfile
└── nginx.conf
```

## 账号系统

- **注册/登录**：输入邮箱 → 获取验证码 → 验证即登录（无密码）
- **数据同步**：登录后学习进度、生词本自动同步到云端
- **离线优先**：断网照常使用，恢复网络后自动同步
- **打卡规则**：登录状态下听听力才计入打卡天数

## 技术栈

| 层 | 技术 |
|----|------|
| UI 框架 | Vue 3 (CDN) |
| 样式 | Tailwind CSS 3 (CDN) |
| 语音 | Web Speech API |
| 词典 | Free Dictionary API |
| 翻译 | MyMemory API |
| 存储 | localStorage + Cloudflare D1 |
| 认证 | JWT (HMAC-SHA256) |
| 部署 | GitHub Pages + Cloudflare Workers |
| 备选部署 | Docker (nginx + Node.js) |

## License

MIT
