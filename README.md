<div align="center">

# 🎧 Listening Hub

### *沉浸式英语听力练习平台*

**100篇精选听力材料 · 逐句精听 · 中英对照 · 智能生词本 · 勋章成就 · 纯静态零依赖**

<p>
  <img alt="Vue" src="https://img.shields.io/badge/Vue-3.x-42b883?style=flat-square&logo=vue.js&logoColor=white" />
  <img alt="Tailwind" src="https://img.shields.io/badge/Tailwind-3.x-38bdf8?style=flat-square&logo=tailwindcss&logoColor=white" />
  <img alt="GitHub Pages" src="https://img.shields.io/badge/GitHub-Pages-222?style=flat-square&logo=github&logoColor=white" />
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
| 📊 **学习统计** | 打卡天数、连续 streak、已听句数，本地自动记录 |
| 📝 **听写模式** | 听后默写，自动对比原文 |
| 🎙️ **跟读录音** | 录制发音与原文对比 |
| 🎨 **三色主题** | 明亮 / 复古 / 暗黑，护眼阅读 |
| 📱 **PWA 离线** | 可安装到桌面，无网也能用 |
| 🏷️ **20 分类** | Health、Science、Technology、History 等，每类 5 篇 |

## 架构

纯静态单页应用，无后端、无账号系统：

```
┌─────────────────────────────────────────┐
│  GitHub Pages（纯静态托管）               │
│  Vue 3 CDN + Tailwind CSS + Web Speech  │
│  所有数据存储在浏览器 localStorage        │
│  PWA Service Worker 提供离线能力          │
└─────────────────────────────────────────┘
```

学习进度、生词本、成就等数据全部保存在本设备浏览器中，无需登录。

## 快速开始

### 在线访问

直接打开 GitHub Pages 地址即可使用，无需安装。

### 本地开发

```bash
# 零依赖，无需 npm，任意静态服务器即可
python3 -m http.server 8080
# 打开 http://localhost:8080
```

## 部署（GitHub Pages）

推送到 `main`/`master` 分支后，`.github/workflows/deploy.yml` 会自动完成部署：

1. 注入 commit sha 到 Service Worker 缓存名（确保客户端更新）
2. 上传整个目录为 Pages artifact
3. 发布到 GitHub Pages

仓库设置中将 Pages 的 Source 设为 "GitHub Actions" 即可。

## 项目结构

```
├── index.html          # 主页面（Vue 3 SPA）
├── app.js              # 业务逻辑
├── data/episodes.js    # 100 篇听力材料数据
├── manifest.json       # PWA 配置
├── service-worker.js   # 离线缓存
└── .github/workflows/deploy.yml  # GitHub Pages 自动部署
```

## 技术栈

| 层 | 技术 |
|----|------|
| UI 框架 | Vue 3 (CDN) |
| 样式 | Tailwind CSS 3 (CDN) |
| 语音 | Web Speech API |
| 词典 | Free Dictionary API |
| 翻译 | MyMemory API |
| 存储 | localStorage |
| 部署 | GitHub Pages (Actions) |

## License

MIT
