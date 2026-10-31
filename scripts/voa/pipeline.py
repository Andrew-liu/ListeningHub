#!/usr/bin/env python3
"""VOA Learning English 真人听力素材管线。

VOA Learning English 的文本与 MP3 属于美国政府作品（公有领域），
官方声明允许以教育或商业目的转载，需署名 learningenglish.voanews.com。

子命令（均可断点续跑，结果缓存在 scripts/.cache/voa/）：
  crawl      按专栏抓取文章页，解析标题 / 文稿 / MP3 / 生词表，写入 selection.json
  audio      下载原始 MP3 并转码为 48kbps 单声道，输出到 audio/voa/<id>.mp3
  align      用 mlx-whisper 做词级时间戳识别，把官方文稿逐句对齐到音频
  translate  调用本地 OpenAI 兼容大模型，把句子与生词释义翻译成中文
  build      产出 data/listening/index.json 与 data/listening/episodes/<id>.json
  all        依次执行以上步骤

用法：
  .venv/bin/python scripts/voa/pipeline.py all
  .venv/bin/python scripts/voa/pipeline.py translate --api http://127.0.0.1:8000/v1 --model xxx
"""
from __future__ import annotations

import argparse
import difflib
import html
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / "scripts" / ".cache" / "voa"
SELECTION = ROOT / "scripts" / "voa" / "selection.json"
AUDIO_OUT = ROOT / "audio" / "voa"
DATA_OUT = ROOT / "data" / "listening"
BASE = "https://learningenglish.voanews.com"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ListeningHub-builder/1.0 (+github.com/Andrew-liu/ListeningHub)"

# 专栏 → (栏目中文名, 分类, 难度, 目标篇数)
PROGRAMS = {
    3521: ("As It Is 新闻", "News", "B1", 22),
    955: ("健康与生活", "Health", "B1", 12),
    1579: ("科学与技术", "Science", "B1", 12),
    986: ("艺术与文化", "Culture", "B1", 10),
    959: ("教育", "Education", "B1", 8),
    987: ("词汇与故事", "Idioms", "A2", 12),
    4456: ("日常语法", "Grammar", "A2", 6),
    979: ("美国历史", "History", "B1", 8),
    5091: ("美国总统", "Biography", "B1", 6),
    4791: ("美国国家公园", "Travel", "B1", 4),
    5535: ("问问老师", "Grammar", "A2", 6),
    1581: ("美国故事", "Stories", "B2", 6),
}
MAX_MINUTES = 22  # 单篇时长上限，过长的有声小说跳过
WHISPER_MODEL = "mlx-community/whisper-large-v3-turbo"


# ── 通用工具 ──────────────────────────────────────────────────────────────────
def log(*a):
    print(*a, flush=True)


def http_get(url: str, binary: bool = False, retries: int = 3, timeout: int = 60):
    """用 curl 下载（urllib 在部分网络下会先卡 IPv6 30 秒）。"""
    last = None
    for i in range(retries):
        r = subprocess.run(["curl", "-sSL", "--fail", "-m", str(timeout), "-A", UA, url], capture_output=True)
        if r.returncode == 0 and r.stdout:
            return r.stdout if binary else r.stdout.decode("utf-8", "replace")
        last = r.stderr.decode("utf-8", "replace").strip()
        time.sleep(1.5 * (i + 1))
    raise RuntimeError(f"GET failed {url}: {last}")


def cached_get(url: str, name: str) -> str:
    p = CACHE / "html" / name
    if p.exists():
        return p.read_text("utf-8")
    p.parent.mkdir(parents=True, exist_ok=True)
    text = http_get(url)
    p.write_text(text, "utf-8")
    time.sleep(0.3)
    return text


def load_json(p: Path, default):
    return json.loads(p.read_text("utf-8")) if p.exists() else default


def save_json(p: Path, obj, compact: bool = False):
    p.parent.mkdir(parents=True, exist_ok=True)
    if compact:
        p.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), "utf-8")
    else:
        p.write_text(json.dumps(obj, ensure_ascii=False, indent=1), "utf-8")


def strip_tags(s: str) -> str:
    s = re.sub(r"<br\s*/?>", " ", s)
    s = re.sub(r"<[^>]+>", "", s)
    s = html.unescape(s).replace("\xa0", " ")
    return re.sub(r"\s+", " ", s).strip()


def ffmpeg_bin() -> str:
    local = ROOT / ".venv" / "bin" / "ffmpeg"
    if local.exists():
        return str(local)
    found = shutil.which("ffmpeg")
    if not found:
        sys.exit("未找到 ffmpeg，请先运行 scripts/setup.sh")
    return found


# ── 1. crawl ─────────────────────────────────────────────────────────────────
ART_RE = re.compile(r'href="(/a/[a-z0-9\-]+/(\d+)\.html)"')
GLOSS_RE = re.compile(r"^(?P<term>[^–\-—:]{1,60}?)\s*[–—\-]\s*(?P<pos>(?:n|v|adj|adv|prep|conj|pron|phrasal v|idiom|expression|abbr|interj)\.?(?:\s*(?:phrase|pl\.))?)\s+(?P<def>.+)$", re.I)
SKIP_PARA = re.compile(r"^(No media source currently available|_+|Share|Print|See comments|Follow us|Quiz -|Words in This Story|Practice what you)", re.I)
CREDIT_RE = re.compile(r"(reported (?:on )?this story|adapted (?:it|this story|the story)|wrote this (?:story|lesson)|edited by|was the editor|for VOA Learning English\.?$|^_{3,})", re.I)


def parse_article(page: str) -> dict | None:
    title_m = re.search(r'<meta content="([^"]+)" property="og:title"', page)
    title = strip_tags(title_m.group(1)) if title_m else ""
    mp3s = re.findall(r"https://voa-audio[a-z\-]*\.voanews\.eu/[^\"'&\s]+?\.mp3", page)
    if not mp3s:
        return None
    hq = [u for u in mp3s if u.endswith("_hq.mp3")]
    mp3 = (hq or mp3s)[0]
    dur_m = re.search(r'"duration"\s*:\s*"?(\d+)', page) or re.search(r'data-duration="(\d+)"', page)
    date_m = re.search(r'<time[^>]*datetime="(\d{4}-\d{2}-\d{2})', page) or re.search(r'"datePublished"\s*:\s*"(\d{4}-\d{2}-\d{2})', page)

    i = page.find('id="article-content"')
    if i < 0:
        i = page.find('class="wsw"')
    if i < 0:
        return None
    seg = page[i:i + 200000]
    end = seg.find('class="comments')
    if end > 0:
        seg = seg[:end]

    paras, gloss, credits = [], [], []
    in_gloss = False
    for block in re.findall(r"<(p|h2|h3|h4)[^>]*>(.*?)</\1>", seg, re.S):
        tag, inner = block
        text = strip_tags(inner)
        if not text:
            continue
        if tag != "p" or re.match(r"^_{3,}", text) or re.match(r"^Words in This Story", text, re.I):
            if re.search(r"Words in This Story|^_{3,}", text, re.I):
                in_gloss = True
            elif tag != "p" and in_gloss is False and len(text) < 80:
                # 小标题也会被朗读，保留
                paras.append(text)
            continue
        if in_gloss:
            m = GLOSS_RE.match(text)
            if m:
                gloss.append({"term": m.group("term").strip(), "pos": m.group("pos").strip(), "def": m.group("def").strip()})
            continue
        if SKIP_PARA.match(text):
            continue
        if CREDIT_RE.search(text) and len(text) < 220:
            credits.append(text)
            continue
        paras.append(text)

    if len(paras) < 4:
        return None
    return {
        "title": title,
        "mp3": mp3,
        "duration": int(dur_m.group(1)) if dur_m else 0,
        "date": date_m.group(1) if date_m else "",
        "paragraphs": paras,
        "glossary": gloss,
        "credits": credits,
    }


def cmd_crawl(args):
    selection = load_json(SELECTION, {})
    for zone, (pname, cat, level, want) in PROGRAMS.items():
        have = [k for k, v in selection.items() if v["zone"] == zone]
        if len(have) >= want:
            log(f"[crawl] {pname}: 已有 {len(have)} 篇，跳过")
            continue
        log(f"[crawl] {pname} (zone {zone}) 目标 {want} 篇")
        page_no = 0
        seen_empty = 0
        while len(have) < want and page_no < 12 and seen_empty < 2:
            url = f"{BASE}/z/{zone}" + (f"?p={page_no}" if page_no else "")
            listing = cached_get(url, f"z{zone}_p{page_no}.html")
            links = list(dict.fromkeys(ART_RE.findall(listing)))
            seen_empty = seen_empty + 1 if not links else 0
            for href, aid in links:
                if len(have) >= want:
                    break
                key = f"voa-{aid}"
                if key in selection:
                    continue
                try:
                    art_html = cached_get(BASE + href, f"a{aid}.html")
                except RuntimeError as e:
                    log("   !", e)
                    continue
                art = parse_article(art_html)
                if not art:
                    continue
                words = sum(len(p.split()) for p in art["paragraphs"])
                if words < 150 or words > MAX_MINUTES * 120:
                    continue
                art.update({"id": key, "zone": zone, "url": BASE + href})
                selection[key] = art
                have.append(key)
                log(f"   + {key} {art['title'][:60]} ({words} words, {len(art['glossary'])} gloss)")
                save_json(SELECTION, selection)
            page_no += 1
    save_json(SELECTION, selection)
    log(f"[crawl] 共 {len(selection)} 篇")


# ── 2. audio ─────────────────────────────────────────────────────────────────
def cmd_audio(args):
    selection = load_json(SELECTION, {})
    ff = ffmpeg_bin()
    raw_dir = CACHE / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)
    AUDIO_OUT.mkdir(parents=True, exist_ok=True)
    for i, (key, art) in enumerate(selection.items(), 1):
        aid = key.split("-", 1)[1]
        out = AUDIO_OUT / f"{aid}.mp3"
        if out.exists() and out.stat().st_size > 10000:
            continue
        raw = raw_dir / f"{aid}.mp3"
        if not raw.exists():
            log(f"[audio] {i}/{len(selection)} 下载 {key}")
            data = http_get(art["mp3"], binary=True, timeout=180)
            raw.write_bytes(data)
        subprocess.run([ff, "-loglevel", "error", "-y", "-i", str(raw), "-ac", "1", "-ar", "24000",
                        "-b:a", "48k", "-map_metadata", "-1", str(out)], check=True)
        log(f"[audio] {key} → {out.stat().st_size // 1024} KB")


def probe_duration(path: Path) -> float:
    ff = ffmpeg_bin()
    r = subprocess.run([ff, "-i", str(path), "-f", "null", "-"], capture_output=True, text=True)
    m = re.findall(r"time=(\d+):(\d+):(\d+\.\d+)", r.stderr)
    if not m:
        return 0.0
    h, mi, s = m[-1]
    return int(h) * 3600 + int(mi) * 60 + float(s)


# ── 3. align ─────────────────────────────────────────────────────────────────
ABBR = r"(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|Mt|Ft|Gen|Gov|Sen|Rep|Rev|Capt|Lt|Col|No|vs|etc|Inc|Co|Corp|Ltd|Jan|Feb|Mar|Apr|Aug|Sept|Sep|Oct|Nov|Dec|U\.S|U\.N|U\.K|a\.m|p\.m|i\.e|e\.g)"


def split_sentences(par: str) -> list[str]:
    protected = re.sub(rf"\b({ABBR})\.", lambda m: m.group(1).replace(".", "§") + "§", par)
    # 逐个查找句末标点，保留结尾引号
    out, start = [], 0
    for m in re.finditer(r'[.!?]["”’)]?\s+(?=["“‘(]?[A-Z0-9])', protected):
        out.append(protected[start:m.end()].strip())
        start = m.end()
    out.append(protected[start:].strip())
    out = [s.replace("§", ".") for s in out if s]
    merged: list[str] = []
    for s in out:
        if merged and len(s.split()) <= 2 and not re.match(r"^I[’']m ", s):
            merged[-1] += " " + s
        else:
            merged.append(s)
    return merged


def norm_tokens(text: str) -> list[str]:
    text = text.lower().replace("’", "'").replace("‘", "'")
    text = re.sub(r"(?<=\d),(?=\d)", "", text)
    text = text.replace("%", " percent")
    toks = re.findall(r"[a-z0-9']+", text)
    return [t.strip("'") for t in toks if t.strip("'")]


def whisper_words(audio: Path, cache_file: Path) -> list[dict]:
    if cache_file.exists():
        return json.loads(cache_file.read_text("utf-8"))
    import mlx_whisper  # noqa: WPS433
    os.environ["PATH"] = str(ROOT / ".venv" / "bin") + os.pathsep + os.environ.get("PATH", "")
    res = mlx_whisper.transcribe(str(audio), path_or_hf_repo=WHISPER_MODEL, language="en",
                                 word_timestamps=True, condition_on_previous_text=False, verbose=None)
    words = []
    for seg in res.get("segments", []):
        for w in seg.get("words", []) or []:
            words.append({"w": w["word"].strip(), "s": round(float(w["start"]), 3), "e": round(float(w["end"]), 3)})
    cache_file.parent.mkdir(parents=True, exist_ok=True)
    cache_file.write_text(json.dumps(words, ensure_ascii=False), "utf-8")
    return words


def align_episode(art: dict, words: list[dict], duration: float) -> dict:
    sentences = []
    for pi, par in enumerate(art["paragraphs"]):
        for s in split_sentences(par):
            sentences.append({"en": s, "p": pi})

    asr_tok, asr_idx = [], []
    for wi, w in enumerate(words):
        for t in norm_tokens(w["w"]):
            asr_tok.append(t)
            asr_idx.append(wi)
    ref_tok, ref_sent = [], []
    for si, s in enumerate(sentences):
        for t in norm_tokens(s["en"]):
            ref_tok.append(t)
            ref_sent.append(si)

    sm = difflib.SequenceMatcher(None, ref_tok, asr_tok, autojunk=False)
    ref2asr: dict[int, int] = {}
    for a, b, n in sm.get_matching_blocks():
        for k in range(n):
            ref2asr[a + k] = asr_idx[b + k]

    per_sent: dict[int, list[int]] = {}
    totals: dict[int, int] = {}
    for ri, si in enumerate(ref_sent):
        totals[si] = totals.get(si, 0) + 1
        if ri in ref2asr:
            per_sent.setdefault(si, []).append(ref2asr[ri])

    kept = []
    for si, s in enumerate(sentences):
        hits = per_sent.get(si, [])
        total = totals.get(si, 0)
        if total == 0 or len(hits) / total < 0.45:
            continue  # 文稿里有但音频没读（署名、图片说明等）
        s["t0"] = words[min(hits)]["s"]
        s["t1"] = words[max(hits)]["e"]
        s["match"] = round(len(hits) / total, 2)
        kept.append(s)

    # 时间单调化 + 边界留白：句首提前 0.12s，句尾延后至多 0.3s，且不与相邻句重叠
    for i, s in enumerate(kept):
        prev_end = kept[i - 1]["t1"] if i else 0.0
        if s["t0"] < prev_end:
            s["t0"] = prev_end
        if s["t1"] <= s["t0"]:
            s["t1"] = s["t0"] + 0.5
    for i, s in enumerate(kept):
        prev_end = kept[i - 1]["t1"] if i else 0.0
        next_start = kept[i + 1]["t0"] if i + 1 < len(kept) else (duration or s["t1"] + 1)
        s["t0"] = round(max(prev_end, s["t0"] - 0.12), 2)
        s["t1"] = round(min(next_start, s["t1"] + 0.3), 2)

    matched_ratio = sum(len(per_sent.get(i, [])) for i in range(len(sentences))) / max(1, len(ref_tok))
    spoken_words = sum(len(norm_tokens(s["en"])) for s in kept)
    speech_time = sum(s["t1"] - s["t0"] for s in kept) or 1
    return {
        "sentences": kept,
        "dropped": len(sentences) - len(kept),
        "matchRatio": round(matched_ratio, 3),
        "wpm": round(spoken_words / speech_time * 60),
    }


def cmd_align(args):
    selection = load_json(SELECTION, {})
    out_dir = CACHE / "aligned"
    for i, (key, art) in enumerate(selection.items(), 1):
        aid = key.split("-", 1)[1]
        target = out_dir / f"{aid}.json"
        if target.exists() and not args.force:
            continue
        audio = AUDIO_OUT / f"{aid}.mp3"
        if not audio.exists():
            log(f"[align] 缺少音频 {key}，先运行 audio")
            continue
        t = time.time()
        words = whisper_words(audio, CACHE / "whisper" / f"{aid}.json")
        dur = probe_duration(audio)
        res = align_episode(art, words, dur)
        res["duration"] = round(dur, 1)
        save_json(target, res)
        log(f"[align] {i}/{len(selection)} {key} 句={len(res['sentences'])} 丢弃={res['dropped']} "
            f"匹配={res['matchRatio']} wpm={res['wpm']} 用时 {time.time() - t:.0f}s")


# ── 4. translate ─────────────────────────────────────────────────────────────
TRANSLATE_SYS = (
    "你是专业英汉翻译。用户会给出若干行带编号的英文句子，格式为“编号<TAB>英文”。"
    "请把每一行翻译成自然、准确的简体中文，人名地名用通行译名，引号用中文引号“”。"
    "按相同编号逐行输出“编号<TAB>译文”，行数与输入一致，不要合并或拆分行，不要输出其它内容。"
)


def llm_chat(api: str, model: str, system: str, user: str, timeout: int = 600) -> str:
    body = json.dumps({
        "model": model,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "temperature": 0.2,
        "max_tokens": 8192,
        "chat_template_kwargs": {"enable_thinking": False},
    }).encode()
    req = urllib.request.Request(api.rstrip("/") + "/chat/completions", data=body,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        data = json.loads(r.read())
    text = data["choices"][0]["message"]["content"]
    return re.sub(r"<think>.*?</think>", "", text, flags=re.S).strip()


def parse_numbered(text: str, n: int) -> list[str]:
    out: dict[int, str] = {}
    for line in text.splitlines():
        m = re.match(r"^\s*(\d+)\s*(?:\t|[.、:：)）]\s*|\s{2,})(.*)$", line)
        if m:
            k = int(m.group(1))
            if 1 <= k <= n and k not in out:
                out[k] = m.group(2).strip()
    if len(out) != n:
        raise ValueError(f"got {len(out)}/{n} lines")
    return [out[i] for i in range(1, n + 1)]


def translate_batch(api, model, items: list[str], system: str = TRANSLATE_SYS) -> list[str]:
    user = "\n".join(f"{i}\t{s.replace(chr(10), ' ')}" for i, s in enumerate(items, 1))
    for attempt in range(3):
        try:
            return parse_numbered(llm_chat(api, model, system, user), len(items))
        except Exception as e:  # noqa: BLE001
            log("   重试", attempt + 1, e)
    if len(items) > 1:  # 对不齐时拆半重试
        mid = len(items) // 2
        return translate_batch(api, model, items[:mid], system) + translate_batch(api, model, items[mid:], system)
    return [""]


GLOSS_SYS = (
    "你是英汉词典编辑。用户会给出若干行“编号<TAB>词条 (词性): 英文释义”。"
    "请按英文释义给出简洁的中文释义（2~12 个字，可用分号分隔近义说法），不要重复词条和词性。"
    "按相同编号逐行输出“编号<TAB>中文释义”，行数与输入一致，不要输出其它内容。"
)


def cmd_translate(args):
    selection = load_json(SELECTION, {})
    zh_dir = CACHE / "zh"
    items = list(selection.items())
    if args.reverse:
        items.reverse()
    for i, (key, art) in enumerate(items, 1):
        aid = key.split("-", 1)[1]
        target = zh_dir / f"{aid}.json"
        aligned = load_json(CACHE / "aligned" / f"{aid}.json", None)
        if not aligned or (target.exists() and not args.force):
            continue
        t = time.time()
        sents = [s["en"] for s in aligned["sentences"]]
        zh: list[str] = []
        for j in range(0, len(sents), 20):
            zh += translate_batch(args.api, args.model, sents[j:j + 20])
        title_zh = translate_batch(args.api, args.model, [art["title"]])[0]
        gloss_src = [f"{g['term']} ({g['pos']}): {g['def']}" for g in art["glossary"]]
        gloss_zh = translate_batch(args.api, args.model, gloss_src, GLOSS_SYS) if gloss_src else []
        save_json(target, {"title": title_zh, "sentences": zh, "glossary": gloss_zh})
        log(f"[translate] {i}/{len(selection)} {key} {len(sents)} 句 用时 {time.time() - t:.0f}s")


# ── 5. build ─────────────────────────────────────────────────────────────────
def cmd_build(args):
    selection = load_json(SELECTION, {})
    ep_dir = DATA_OUT / "episodes"
    ep_dir.mkdir(parents=True, exist_ok=True)
    index = []
    for key, art in selection.items():
        aid = key.split("-", 1)[1]
        aligned = load_json(CACHE / "aligned" / f"{aid}.json", None)
        if not aligned or len(aligned["sentences"]) < 4 or aligned["matchRatio"] < 0.6:
            log(f"[build] 跳过 {key}（未对齐或匹配度低）")
            continue
        zh = load_json(CACHE / "zh" / f"{aid}.json", {"title": "", "sentences": [], "glossary": []})
        pname, cat, level, _ = PROGRAMS[art["zone"]]
        if not art.get("date"):
            page = CACHE / "html" / f"a{aid}.html"
            m = re.search(r'"datePublished"\s*:\s*"(\d{4}-\d{2}-\d{2})', page.read_text("utf-8")) if page.exists() else None
            art["date"] = m.group(1) if m else ""
        sents = []
        for n, s in enumerate(aligned["sentences"], 1):
            item = {"id": n, "en": s["en"], "t0": s["t0"], "t1": s["t1"], "p": s["p"]}
            if n - 1 < len(zh["sentences"]) and zh["sentences"][n - 1]:
                item["zh"] = zh["sentences"][n - 1]
            sents.append(item)
        gloss = []
        for gi, g in enumerate(art["glossary"]):
            g2 = dict(g)
            if gi < len(zh.get("glossary", [])) and zh["glossary"][gi]:
                g2["zh"] = zh["glossary"][gi]
            gloss.append(g2)
        ep = {
            "id": key,
            "title": art["title"],
            "titleZh": zh.get("title", ""),
            "program": pname,
            "category": cat,
            "level": level,
            "date": art["date"],
            "source": art["url"],
            "audio": f"audio/voa/{aid}.mp3",
            "duration": aligned["duration"],
            "wpm": aligned["wpm"],
            "credits": art["credits"],
            "sentences": sents,
            "glossary": gloss,
        }
        save_json(ep_dir / f"{key}.json", ep, compact=True)
        index.append({k: ep[k] for k in ("id", "title", "titleZh", "program", "category", "level", "date", "duration", "wpm")}
                     | {"sentenceCount": len(sents), "glossaryCount": len(gloss)})
    index.sort(key=lambda e: e["date"], reverse=True)
    save_json(DATA_OUT / "index.json", {
        "source": "VOA Learning English (learningenglish.voanews.com) · Public Domain",
        "generatedAt": time.strftime("%Y-%m-%d"),
        "episodes": index,
    }, compact=True)
    total_min = sum(e["duration"] for e in index) / 60
    log(f"[build] 输出 {len(index)} 篇，共 {total_min:.0f} 分钟真人音频")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=["crawl", "audio", "align", "translate", "build", "all"])
    ap.add_argument("--force", action="store_true", help="忽略缓存重新生成")
    ap.add_argument("--reverse", action="store_true", help="倒序处理（便于开第二个翻译进程并行）")
    ap.add_argument("--api", default=os.environ.get("LLM_API", "http://127.0.0.1:8000/v1"))
    ap.add_argument("--model", default=os.environ.get("LLM_MODEL", "local"))
    args = ap.parse_args()
    steps = ["crawl", "audio", "align", "translate", "build"] if args.cmd == "all" else [args.cmd]
    for s in steps:
        globals()[f"cmd_{s}"](args)


if __name__ == "__main__":
    main()
