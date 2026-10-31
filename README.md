<div align="center">

# 🎧 Listening Hub

### *真人原声英语听力训练 + 词光雅思背单词*

**VOA Learning English 真人播音 · Whisper 逐句时间轴 · 五步精听 · 7 轮间隔复习 · 词光 7298 词插画词库 · 纯静态零后端**

<p>
  <img alt="Vue" src="https://img.shields.io/badge/Vue-3.x-42b883?style=flat-square&logo=vue.js&logoColor=white" />
  <img alt="Tailwind" src="https://img.shields.io/badge/Tailwind-3.x-38bdf8?style=flat-square&logo=tailwindcss&logoColor=white" />
  <img alt="GitHub Pages" src="https://img.shields.io/badge/GitHub-Pages-222?style=flat-square&logo=github&logoColor=white" />
  <img alt="PWA" src="https://img.shields.io/badge/PWA-Installable-blueviolet?style=flat-square" />
</p>

</div>

---

## 功能

| 模块 | 说明 |
|------|------|
| 🎙️ **真人原声素材** | 精选 VOA Learning English 12 个栏目（As It Is、健康、科技、历史、词汇与故事、美国故事等）的真人播音，不使用任何机器朗读 |
| ⏱️ **逐句时间轴** | 官方文稿经 Whisper 词级识别对齐到音频，点哪句播哪句；单句循环、逐句暂停、0.6×～1.2× 变速不变调 |
| 🧭 **五步首学** | 盲听 → 精听 → 听写 → 跟读 → 复述，按阶段推进（训练法参考 Echo Loop） |
| 🔁 **7 轮间隔复习** | 首学完成后按 6h / 1d / 2d / 4d / 7d / 14d / 28d 自动排期，复习内容为盲听 + 难句 + 复述 |
| ⭐ **难句本** | 按 `H` 标记难句，听写低于 80 分自动收录，跨篇目集中复练 |
| ✍️ **听写** | 原声逐句默写，LCS 逐词比对（漏听 / 写错 / 多写分色） |
| 🗣️ **跟读 / 复述录音** | 浏览器本地录音，与原声连续对比回放 |
| 📂 **导入自己的素材** | 音频 + LRC / SRT / VTT（支持中英双语行），保存在本机 IndexedDB，不上传 |
| 📚 **生词本** | 点词查义；收藏时保存原句与时间戳，复习时直接回放那一句真人原声；SM-2 间隔复习；Anki / CSV 导出 |
| 🖼️ **背单词 · 词光** | [词光 Word Atlas](https://github.com/designfuchen/word-atlas) 雅思 7298 词：插画、CEFR、19 话题、英美发音、例句朗读、搭配、词族、辨析 |
| 📖 **其它词库** | 初中 / 高中 / CET4 / CET6 / 考研 / 托福 / SAT（源自 KyleBing/english-vocabulary） |
| ⌨️ **拼写 / 默写** | 逐字母键入，错误次数映射记忆曲线评分，错 3 次自动进生词本 |

## 架构

纯静态站点，部署在 GitHub Pages，没有后端和账号：

```
浏览器（Vue 3 CDN + 原生 ES Module，无构建步骤）
 ├─ data/listening/   VOA 篇目索引 + 每篇句子时间轴 / 译文 / 生词表（JSON）
 ├─ audio/voa/        VOA 真人音频（48kbps 单声道 MP3，同源托管，支持 Range 精确 seek）
 ├─ data/vocab/       8 个词库分片（200 词/片，按需加载）
 ├─ data/atlas/       词光缩略图 + 英美单词发音（本地托管）
 │                    512px 大图与例句朗读按固定 commit 外链上游仓库
 └─ localStorage / IndexedDB  学习进度、生词本、训练状态、导入素材
```

素材是离线预处理好的，由 `scripts/` 下的管线生成：

```
VOA 文章页 ──crawl──▶ 标题 / 文稿 / MP3 / Words in This Story
   MP3 ──audio──▶ ffmpeg 转 48kbps 单声道
       ──align──▶ mlx-whisper 词级时间戳 ⟷ 官方文稿 difflib 对齐 → 逐句 t0/t1
       ──translate──▶ 本地 LLM（OpenAI 兼容接口）翻译句子与生词释义
       ──build──▶ data/listening/*.json
```

## 本地运行

```bash
# 需要支持 HTTP Range 的静态服务器（逐句 seek 依赖它），不要用 python -m http.server
npx http-server -p 8080 -c-1 .
# 打开 http://localhost:8080
```

## 更新 / 扩充素材

```bash
uv venv --python 3.11 .venv
uv pip install --python .venv/bin/python mlx-whisper imageio-ffmpeg   # Apple Silicon
ln -sf "$(.venv/bin/python -c 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())')" .venv/bin/ffmpeg

# 栏目与篇数在 scripts/voa/pipeline.py 的 PROGRAMS 中配置
.venv/bin/python scripts/voa/pipeline.py crawl
.venv/bin/python scripts/voa/pipeline.py audio
.venv/bin/python scripts/voa/pipeline.py align
LLM_API=http://localhost:8000/v1 LLM_MODEL=<模型名> .venv/bin/python scripts/voa/pipeline.py translate
.venv/bin/python scripts/voa/pipeline.py build

# 同步词光词库（自动浅克隆上游）
python3 scripts/atlas/import_atlas.py
```

每一步都有缓存（`scripts/.cache/`，已 gitignore），可以断点续跑；`build` 只输出词匹配率不低于 60% 的篇目。

## 部署（GitHub Pages）

推送到 `main` / `master` 后，`.github/workflows/deploy.yml` 会自动发布，Service Worker 的缓存名会替换成 commit sha。仓库 Settings → Pages 的 Source 选 “GitHub Actions”。

当前体积约 520MB（音频约 250MB、词光媒体约 200MB），在 GitHub Pages 1GB 的站点上限以内。继续扩充素材前，先用 `du -sh audio data` 看一下总量。

## 内容来源与授权

| 内容 | 来源 | 授权 |
|------|------|------|
| 听力音频与英文文稿 | [VOA Learning English](https://learningenglish.voanews.com) | 美国政府作品，公有领域；VOA 允许教育与商业用途转载，需注明出处。文中引用的美联社 / 路透社图片不在此列，本项目没有收录 |
| 句子时间轴 | 本项目用 Whisper 生成 | MIT |
| 中文译文与生词释义 | 本项目用本地大模型机器翻译 | 仅供参考，可能有误 |
| 雅思词库、插画、单词与例句录音 | [词光 Word Atlas](https://github.com/designfuchen/word-atlas)（designfuchen） | CC BY 4.0，署名 Word Atlas contributors（词光）；转换了数据格式，内容没有修改。上游说明：内容由 AI 生成，未逐条人工审校；录音为 ElevenLabs 合成语音 |
| 其它词库 | [KyleBing/english-vocabulary](https://github.com/KyleBing/english-vocabulary) | 遵循上游授权 |
| 应用代码 | 本仓库 | MIT |

完整署名见 [ATTRIBUTION.md](ATTRIBUTION.md)。

## License

代码 MIT；第三方内容遵循上表各自的授权。
