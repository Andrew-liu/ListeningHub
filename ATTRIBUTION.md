# Attribution / 内容署名

## VOA Learning English

`audio/voa/` 下的音频，以及 `data/listening/` 中的英文文稿、标题和 "Words in This Story" 生词表，来自 VOA Learning English（https://learningenglish.voanews.com）。

VOA 声明：Learning English 的文本、MP3 和视频属于公有领域，允许以教育或商业目的转载，需注明出处 learningenglish.voanews.com。美联社（AP）、路透社（Reuters）等通讯社的图片和视频受版权保护，本项目没有收录任何图片或视频。

每篇素材的原文链接保存在 `data/listening/episodes/<id>.json` 的 `source` 字段，页面上也有“VOA 原文 ↗”链接。

本项目对素材做了以下处理：
- 音频重新编码为 48kbps 单声道 MP3；
- 用 Whisper（mlx-community/whisper-large-v3-turbo）生成逐句时间轴；
- 去掉了没有朗读的署名行和图片说明；
- 中文译文由本地大模型机器翻译，不代表 VOA 观点，可能有误。

Source: VOA Learning English (public domain). Audio re-encoded; sentence timings generated with Whisper; Chinese translations are machine-generated.

## 词光 Word Atlas

`data/vocab/ielts/`、`data/atlas/` 中的词库文本、插画缩略图和单词录音，以及页面外链加载的 512px 插画和例句朗读，来自：

- 项目：词光 Word Atlas — https://github.com/designfuchen/word-atlas
- 作者：Word Atlas contributors（词光），@designfuchen
- 授权：Creative Commons Attribution 4.0 International（CC BY 4.0）— https://creativecommons.org/licenses/by/4.0/
- 上游 commit：见 `data/atlas/meta.json` 的 `commit` 字段
- 修改说明：只把数据格式转换为本项目的词库结构（词头、音标、义项、例句、搭配、词族、近反义、提示、CEFR、话题），释义、例句、插画和录音内容没有修改。

上游说明：内容由 AI 模型生成（文本用大语言模型，插画用图像模型，录音用 ElevenLabs 合成语音，英音 Alice / 美音 Sarah），经过自动校验，未逐条人工审校，按现状提供。它不是官方雅思词表，与雅思考试主办方无关。

## 其它词库

`data/vocab/{chuzhong,gaozhong,cet4,cet6,kaoyan,toefl,sat}/` 来自 KyleBing/english-vocabulary（https://github.com/KyleBing/english-vocabulary），遵循上游授权。

## 训练方法参考

五步首学（盲听、精听、跟读、复述）和 7 轮间隔复习的排期参考了 Echo Loop（https://github.com/echo-loop/Echo-Loop）的公开介绍。本项目没有使用其代码。
