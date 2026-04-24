<div align="center">

# 🎧 Listening Hub

### *A beautiful listening playground for VOA Special English learners*

**基于 VOA Special English 的沉浸式英语听力练习平台 · 逐句精听 · 中英对照 · 智能生词本**

<p>
  <img alt="Vue" src="https://img.shields.io/badge/Vue-3.x-42b883?style=flat-square&logo=vue.js&logoColor=white" />
  <img alt="Tailwind" src="https://img.shields.io/badge/Tailwind_CSS-3.x-38bdf8?style=flat-square&logo=tailwindcss&logoColor=white" />
  <img alt="Web Speech API" src="https://img.shields.io/badge/Web_Speech_API-native-6366f1?style=flat-square" />
  <img alt="PWA" src="https://img.shields.io/badge/PWA-offline_ready-10b981?style=flat-square&logo=pwa&logoColor=white" />
  <img alt="Docker" src="https://img.shields.io/badge/Docker-ready-2496ED?style=flat-square&logo=docker&logoColor=white" />
  <img alt="No Build" src="https://img.shields.io/badge/Build-Zero_Config-f59e0b?style=flat-square" />
  <img alt="License" src="https://img.shields.io/badge/License-MIT-ec4899?style=flat-square" />
</p>

<p>
  <img alt="Episodes" src="https://img.shields.io/badge/Episodes-52-3b82f6?style=for-the-badge" />
  <img alt="Sentences" src="https://img.shields.io/badge/Sentences-418-8b5cf6?style=for-the-badge" />
  <img alt="Categories" src="https://img.shields.io/badge/Categories-20-ec4899?style=for-the-badge" />
</p>

[功能特色](#-功能特色) · [快速开始](#-快速开始) · [使用指南](#-使用指南) · [项目结构](#-项目结构) · [路线图](#-路线图)

</div>

---

## 📖 项目简介

**Listening Hub** 是一个专为英语学习者打造的前端应用，基于 VOA Special English 的标准发音与简明语法，帮助你从"听懂每一句话"开始，循序渐进地建立英语听力与词汇体系。

整个项目是一个**零构建、开箱即用**的纯静态网站，仅依赖 Vue 3 与 Tailwind CSS 的 CDN，不需要 Node.js 环境也能直接运行。

<br/>

## ✨ 功能特色

<table>
<tr>
<td width="50%">

### 🎯 多集节目点播
精选 **52 集 / 20 个主题** 的 VOA 风格内容，涵盖健康、科学、文化、技术、历史、艺术等。支持分类筛选、关键词搜索，快速定位感兴趣的节目。

</td>
<td width="50%">

### 🔁 逐句精听
每一句都可独立播放、循环、回放，搭配 **慢 / 中 / 快** 三档语速调节。整集顺序播放、单句循环两种模式自由切换，打磨每一个发音细节。

</td>
</tr>
<tr>
<td width="50%">

### 🌐 中英双语对照
每句英文配备精准中文翻译，一键切换显示 / 隐藏，支持**纯听力模式**。同时为生词本中的单词提供**完整中文释义**（MyMemory 翻译 API）。

</td>
<td width="50%">

### 📖 智能生词本
点击任意英文单词即可弹出 **音标 + 发音 + 中英双解 + 例句**。一键收藏到生词本并**本地持久化**（localStorage），关闭浏览器数据不丢。

</td>
</tr>
<tr>
<td width="50%">

### ✏️ 听写模式 (Dictation)
只听朗读把内容写下来，**逐词对比评分**（0-100 分）。差异高亮显示，拼写错误一目了然——听辨与拼写双重训练。

</td>
<td width="50%">

### 🎙️ 跟读模式 (Shadowing)
基于 **MediaRecorder API** 原生录音，录下你的发音与原音对比回放。模仿语音语调和节奏，打磨真正地道的英语口语。

</td>
</tr>
<tr>
<td width="50%">

### 🧠 间隔重复复习 (SRS)
简化版 **SM-2 算法**，根据你对单词的熟练度（忘记 / 困难 / 还行 / 熟练）智能安排下次复习时间。"记得牢、忘得慢"。

</td>
<td width="50%">

### 📤 导出生词本
一键导出为 **Anki 制表符格式 (.txt)** 或 **CSV**，无缝同步到 Anki / Quizlet / Excel。支持正面词条 + 音标 + 中文 + 词性释义。

</td>
</tr>
<tr>
<td width="50%">

### 🎨 多主题 & PWA
三色主题切换（☀ Light / ◐ Sepia / ☾ Dark）· **PWA 离线支持**可安装到桌面 · 支持导入真实 VOA MP3 音频 · 移动端适配响应式布局。

</td>
<td width="50%">

### 🔥 学习进度追踪
自动记录**连续打卡天数**、累计练习句数、已完成节目数。首页和顶栏实时显示，让持续学习变得看得见、有成就感。

</td>
</tr>
</table>

<br/>

## 🎬 界面预览

### 首页 Hero
现代化 Landing 页设计 — 渐变主标题、界面预览 mock window、四大功能卡片、数据统计版块。

### 练习界面
- **左侧**：节目库（搜索 + 分类筛选 + 节目卡片）
- **顶部**：控制栏（上一句 / 播放 / 下一句 / 整集播放 / 单句循环 / 语速切换）
- **中部**：句子列表（每句独立高亮、SPEAKING 波形指示器、点词查询）
- **右侧抽屉**：生词本（中文翻译高亮 + 英文释义 + 音标发音）

<br/>

## 🚀 快速开始

### 方式 1：直接打开

```bash
# 克隆或下载仓库
git clone <repo-url>
cd voa-english

# 双击 index.html 即可
```

> ⚠️ 某些浏览器对 `file://` 协议下的 `fetch()` 请求有限制，建议使用方式 2 启动本地服务器。

### 方式 2：本地 HTTP 服务器（推荐）

```bash
# Python 3
python3 -m http.server 28080

# Node.js (需要 npx)
npx serve . -p 28080

# 或 PHP
php -S localhost:28080
```

然后打开浏览器访问 **http://localhost:28080**。

### 方式 3：Docker 部署

```bash
docker compose up -d
```

访问 **http://<主机IP>:28080** 即可。详见下方 [🐳 Docker 部署](#-docker-部署) 章节。

### 方式 4：一键部署到云

| 平台 | 步骤 |
|---|---|
| **GitHub Pages** | 推送到 `main`，Settings → Pages → Source: `main` |
| **Vercel** | `vercel deploy` |
| **Netlify** | 拖拽整个文件夹到 [app.netlify.com/drop](https://app.netlify.com/drop) |
| **Cloudflare Pages** | 连接 GitHub 仓库，无需构建命令 |

<br/>

## 🐳 Docker 部署

基于轻量级 **nginx:alpine** 镜像分发，镜像体积 ≈ 45 MB、运行时内存 ≈ 10 MB。

推荐工作流：**本地打镜像 → 推送 / 导出 → 部署端拉取运行**。

---

### 📦 本地打包镜像

项目根目录提供了一键打包脚本 `build-image.sh`：

```bash
# 仅本地构建
./build-image.sh 1.0

# 构建 + 推送到镜像仓库（需先 docker login）
./build-image.sh 1.0 push

# 构建 + 导出为 tar.gz（离线分发）
./build-image.sh 1.0 save
```

默认镜像名是 `listening-hub/voa-english`。可以通过环境变量覆盖：

```bash
IMAGE_NAME=ghcr.io/yourname/voa-english ./build-image.sh 1.0 push
```

也可以直接用 docker 命令手工构建：

```bash
docker build -t listening-hub/voa-english:1.0 -t listening-hub/voa-english:latest .
docker push listening-hub/voa-english:1.0
```

---

### 🚚 镜像分发

三种方式任选一种。

#### ① 镜像仓库（推荐）

本地推送，部署端拉取，支持版本迭代：

```bash
# 本地
./build-image.sh 1.0 push

# 部署端
docker pull listening-hub/voa-english:1.0
```

**可选仓库**：
- [Docker Hub](https://hub.docker.com/)（公开镜像免费）
- [GitHub Container Registry](https://ghcr.io/)（与 GitHub 账户绑定）
- 自建 [Harbor](https://goharbor.io/) / [registry](https://hub.docker.com/_/registry)

#### ② 离线 tar 包

没有镜像仓库也能用，把 tar 包传到部署端即可：

```bash
# 本地
./build-image.sh 1.0 save      # 生成 voa-english-1.0.tar.gz

# 传给部署端
scp voa-english-1.0.tar.gz user@host:/path/

# 部署端
gunzip -c voa-english-1.0.tar.gz | docker load
```

#### ③ 部署端直接构建

如果部署端能拉取项目源码（SSH / Git clone），也可以直接在部署端构建：

```bash
git clone <repo-url>
cd voa-english
docker compose up -d --build
```

---

### ▶️ 部署端运行

只需要两样东西：**能访问到镜像** + **一份 `docker-compose.yml`**。

将项目目录里的 `docker-compose.yml` 复制到部署端的任意目录，然后：

```bash
docker compose up -d         # 启动
docker compose logs -f       # 查看日志
docker compose down          # 停止
docker compose pull && docker compose up -d   # 更新到最新镜像
```

或者不使用 compose，直接运行：

```bash
docker run -d \
  --name voa-english \
  --restart unless-stopped \
  -p 28080:28080 \
  listening-hub/voa-english:latest
```

启动后浏览器访问 **http://<主机IP>:28080** ✅

---

### ⚙️ 常用调整

**修改对外端口**（例如 28080 已被占用，改为 9090）

编辑 `docker-compose.yml`：

```yaml
ports:
  - "9090:28080"     # 左侧是对外端口，右侧容器内端口不要动
```

**固定镜像版本**

```yaml
image: listening-hub/voa-english:1.0   # 改 latest → 1.0
```

**使用私有仓库**

```yaml
image: ghcr.io/yourname/voa-english:1.0
```

部署端需要先 `docker login ghcr.io` 才能拉取。

---

### 🌐 HTTPS 与公网访问

浏览器的「跟读录音（MediaRecorder）」与「PWA 安装」等 API 在非 HTTPS 环境下会被禁用。

- **局域网 IP 直连** — 浏览器视为安全上下文，所有功能可用 ✅
- **公网域名访问** — 必须 HTTPS，推荐在前面加一层反向代理（Nginx Proxy Manager / Traefik / Caddy / Cloudflare Tunnel）处理证书，容器仍然只暴露 28080 HTTP

---

### 📊 资源占用参考

| 指标 | 数值 |
|---|---|
| 镜像大小 | ≈ 45 MB |
| 运行内存 | ≈ 10 MB |
| CPU（空闲） | < 0.1 % |
| 构建时间 | < 30 s |

## 🛠️ 技术栈

| 层次 | 技术 | 用途 |
|---|---|---|
| **UI 框架** | [Vue 3](https://vuejs.org/) (via CDN) | 响应式数据、组合式 API |
| **样式** | [Tailwind CSS](https://tailwindcss.com/) (via Play CDN) | 原子化 CSS、主题定制 |
| **字体** | Inter / Playfair Display / JetBrains Mono | Google Fonts |
| **语音** | [Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API) | 原生 TTS，免音频文件 |
| **词典** | [Free Dictionary API](https://dictionaryapi.dev/) | 音标、发音、英文释义 |
| **翻译** | [MyMemory API](https://mymemory.translated.net/) | 单词中文翻译 |
| **存储** | `localStorage` | 生词本持久化 |

> 💡 **为何用 Web Speech API？** VOA 官方 MP3 有严格的 CORS 限制不易嵌入，浏览器内置的 TTS 引擎可以即时朗读任意文本、支持调速、零等待、零网络请求。

<br/>

## 📂 项目结构

```
voa-english/
├── 📄 index.html              # 主入口（首页 + 练习界面 + 弹窗 + 抽屉 + 4 个模态框）
├── 📄 app.js                  # Vue 应用逻辑（~900 行）
├── 📄 manifest.json           # PWA 应用清单
├── 📄 service-worker.js       # PWA 离线缓存
├── 🐳 Dockerfile              # nginx alpine 构建
├── 🐳 docker-compose.yml      # 部署端启动（拉镜像运行）
├── 🐳 build-image.sh          # 本地构建 / 推送 / 导出镜像
├── ⚙️ nginx.conf              # nginx 站点配置（28080）
├── 📄 .dockerignore           # 构建忽略清单
├── 📄 README.md               # 项目说明
└── 📁 data/
    └── 📄 episodes.js         # 52 集节目数据（884 句双语）
```

<br/>

## 📖 使用指南

### 基础操作
1. 首页点击 **「立即开始练习」** 进入主界面
2. 左侧栏选择一集节目（可按分类或搜索筛选）
3. 点击 **「整集播放」** 从第 1 句顺序播完整集
4. 或点击任意句子的 ▶ 按钮**只播放该句**

### 高级技巧
- **隐藏中文**：右上角切换，进入纯听力模式
- **单句循环**：开启后会在当前句反复重播（整集模式下也生效）
- **调节语速**：右上角选择慢 0.7x / 中 0.85x / 快 1.0x
- **收藏生词**：点击英文单词 → 查看中英双解 → 加入生词本

### 键盘快捷键

| 快捷键 | 功能 |
|:---:|---|
| <kbd>Space</kbd> | 播放 / 暂停当前句 |
| <kbd>←</kbd> | 上一句 |
| <kbd>→</kbd> | 下一句 |
| <kbd>Esc</kbd> | 关闭弹窗 / 抽屉 |

<br/>

## 🗂️ 节目分类一览

<table>
<tr>
<td>🏥 Health — 健康</td>
<td>🔬 Science — 科学</td>
<td>🌿 Nature — 自然</td>
<td>💻 Technology — 科技</td>
</tr>
<tr>
<td>🎭 Culture — 文化</td>
<td>📜 History — 历史</td>
<td>🍕 Food — 美食</td>
<td>🚀 Space — 太空</td>
</tr>
<tr>
<td>💼 Business — 商业</td>
<td>📚 Education — 教育</td>
<td>✈️ Travel — 旅行</td>
<td>🎵 Music — 音乐</td>
</tr>
<tr>
<td>⚽ Sports — 体育</td>
<td>🧠 Psychology — 心理</td>
<td>🌍 Environment — 环境</td>
<td>👤 Biography — 人物</td>
</tr>
<tr>
<td>🎨 Art — 艺术</td>
<td>💰 Economy — 经济</td>
<td>🎬 Cinema — 电影</td>
<td>💬 Idioms — 习语</td>
</tr>
</table>

<br/>

## 🎨 设计理念

- **Light Theme First** — 明亮、通透、不伤眼
- **Content First** — 文字排版优先于视觉装饰
- **Progressive Disclosure** — 基础功能一目了然，高级功能按需展开
- **Zero Friction** — 打开即用，不需要注册、登录、设置
- **Offline Friendly** — 所有数据和界面都本地加载，仅词典/翻译需要联网

<br/>

## 🗺️ 路线图

### ✅ 已完成
- [x] 首页 Hero 展示页
- [x] 52 集节目 + 20 分类 + 搜索筛选
- [x] 整集顺序播放 / 单句精听 / 单句循环
- [x] 三档语速调节
- [x] 生词本（localStorage 持久化）
- [x] Free Dictionary + MyMemory 双 API 集成
- [x] 键盘快捷键
- [x] 明亮主题 UI
- [x] **学习进度追踪**（连续打卡、累计句数、集数）
- [x] **听写模式**（Dictation，逐词比对评分）
- [x] **跟读模式**（Shadowing，MediaRecorder 录音回放）
- [x] **生词本 SRS 间隔重复复习**（简化版 SM-2）
- [x] **导出生词本**为 Anki (.txt) / CSV
- [x] **多主题切换**（Light / Sepia / Dark）
- [x] **PWA 离线支持**（Service Worker + Manifest）
- [x] **支持导入真实 VOA MP3 音频**

### 🚧 未来可能扩展
- [ ] 每日学习目标 + 成就徽章系统
- [ ] 学习统计图表（weekly heatmap）
- [ ] 云端同步（Supabase / Firebase）
- [ ] 音频段时间戳标注工具
- [ ] 社区分享生词本 / 节目

<br/>

## 🤝 贡献

欢迎通过以下方式参与贡献：

- 🐛 **报告 Bug** — 提交 Issue 描述问题
- 💡 **功能建议** — 提交 Issue 并打上 `enhancement` 标签
- 📝 **扩充节目** — 在 `data/episodes.js` 中添加新集，PR 合并
- 🌍 **多语言** — 添加更多目标语言翻译
- 🎨 **UI 优化** — 改进视觉与交互体验

<br/>

## 📄 License

[MIT License](LICENSE) © 2026 Listening Hub Contributors

### 📻 关于 VOA 内容声明

本项目的 52 集节目内容灵感源自 [**Voice of America - Learning English**](https://learningenglish.voanews.com/)（美国之音学习英语）栏目。文本按照 VOA Special English 标准风格改编而成——**1500 核心词表 · 慢速朗读 · 简明语法**——便于英语学习者逐句精听。

每集对应的官方 VOA 栏目如下（点击可跳转）：

| 分类 | VOA 官方栏目 | 链接 |
|---|---|---|
| Health / Psychology | Health & Lifestyle | [🔗](https://learningenglish.voanews.com/z/3881) |
| Science / Nature / Space / Environment | Science in the News | [🔗](https://learningenglish.voanews.com/z/3879) |
| Technology | Technology Report | [🔗](https://learningenglish.voanews.com/z/3885) |
| Culture / Art / Music / Cinema / Travel | Arts & Culture | [🔗](https://learningenglish.voanews.com/z/3886) |
| History | This Is America | [🔗](https://learningenglish.voanews.com/z/3884) |
| Food / Idioms | Words & Their Stories | [🔗](https://learningenglish.voanews.com/z/3892) |
| Business / Economy | Economics Report | [🔗](https://learningenglish.voanews.com/z/3888) |
| Education | Education Report | [🔗](https://learningenglish.voanews.com/z/3887) |
| Biography | People in America | [🔗](https://learningenglish.voanews.com/z/3891) |
| Sports | In The News | [🔗](https://learningenglish.voanews.com/z/3896) |

> ⚠️ **版权声明**：项目中的文本均为再创作版本，**非 VOA 官方稿件**，仅用于个人学习与教育目的。若需使用 VOA 原声节目，请访问 [voanews.com](https://www.voanews.com/) 及其学习英语子站，所有 VOA 内容版权归其原始所有者所有。

<br/>

## 🙏 鸣谢

- [VOA Learning English](https://learningenglish.voanews.com/) — 内容灵感来源
- [Free Dictionary API](https://dictionaryapi.dev/) — 免费英文词典服务
- [MyMemory API](https://mymemory.translated.net/) — 免费机器翻译服务
- [Vue.js](https://vuejs.org/) & [Tailwind CSS](https://tailwindcss.com/) — 杰出的开源工具
- 所有为开源贡献代码的朋友们 ❤️

<br/>

<div align="center">

**如果这个项目对你有帮助，请 ⭐ Star 支持一下！**

<sub>Built with ❤️ and Vue 3 · Made for language learners everywhere</sub>

</div>
