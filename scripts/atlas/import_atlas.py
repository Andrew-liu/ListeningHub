#!/usr/bin/env python3
"""把 designfuchen/word-atlas（词光）开源词库接入 ListeningHub 背单词模块。

授权：代码 MIT；词库文本、插画、录音 CC BY 4.0（署名 Word Atlas contributors — 词光）。
注意：word-atlas 的录音是 ElevenLabs 合成语音（英音 Alice / 美音 Sarah），不是真人录音。

产出：
  data/vocab/ielts/<n>.json   词条分片（兼容现有词库格式，额外带 atlas 字段）
  data/vocab/ielts/index.json 小写词头列表（供搜索）
  data/vocab/manifest.json    追加 ielts 词库
  data/atlas/meta.json        媒体地址、上游 commit、授权信息
  data/atlas/lookup.json      词头 → atlas id，供其它词库 / 听力查词复用发音与插画
  data/atlas/thumb/<id>.webp          256px 插画（本地托管）
  data/atlas/audio/{uk,us}/<id>.mp3   单词英美发音（本地托管）
  512px 插画与例句朗读体积较大，走上游仓库的固定 commit 外链（raw.githubusercontent.com）。

用法：
  python3 scripts/atlas/import_atlas.py                # 自动浅克隆上游到 scripts/.cache/word-atlas
  python3 scripts/atlas/import_atlas.py --src /path/to/word-atlas
  python3 scripts/atlas/import_atlas.py --no-media     # 只生成文本数据
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REPO = "https://github.com/designfuchen/word-atlas.git"
CHUNK = 200  # 与现有词库 manifest.chunkSize 保持一致


def sh(*cmd, cwd=None) -> str:
    return subprocess.run(cmd, cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()


def strip_slash(ipa: str) -> str:
    return (ipa or "").strip().strip("/").strip()


def split_pair(s: str) -> tuple[str, str]:
    for sep in ("｜", "|"):
        if sep in s:
            a, b = s.split(sep, 1)
            return a.strip(), b.strip()
    return s.strip(), ""


def convert(e: dict) -> dict:
    return {
        "word": e["w"],
        "us": strip_slash(e.get("us")),
        "uk": strip_slash(e.get("uk")),
        "translations": [{"type": s.get("pos", ""), "translation": s.get("zh", "")} for s in e.get("senses", [])],
        "phrases": [dict(zip(("phrase", "translation"), split_pair(c))) for c in e.get("col", [])],
        "sentences": [{"sentence": x.get("en", ""), "translation": x.get("zh", "")} for x in e.get("ex", [])],
        "atlas": {
            "id": e["id"],
            "m": e.get("m", 0),
            "cefr": e.get("cefr", ""),
            "topic": e.get("topic", ""),
            "defs": [s.get("en", "") for s in e.get("senses", [])],
            "fam": e.get("fam", []),
            "syn": e.get("syn", []),
            "ant": e.get("ant", []),
            "tip": e.get("tip", ""),
            "note": e.get("note", ""),
        },
    }


def copy_tree(src: Path, dst: Path, pattern: str) -> tuple[int, int]:
    dst.mkdir(parents=True, exist_ok=True)
    n = size = 0
    for f in src.glob(pattern):
        t = dst / f.name
        if not t.exists() or t.stat().st_size != f.stat().st_size:
            shutil.copy2(f, t)
        n += 1
        size += f.stat().st_size
    return n, size


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", help="本地 word-atlas 仓库路径；缺省时自动浅克隆")
    ap.add_argument("--no-media", action="store_true")
    args = ap.parse_args()

    src = Path(args.src) if args.src else ROOT / "scripts" / ".cache" / "word-atlas"
    if not (src / "public" / "atlas" / "index.json").exists():
        print(f"克隆 {REPO} → {src}（含媒体，约 700MB）")
        src.parent.mkdir(parents=True, exist_ok=True)
        sh("git", "clone", "--depth", "1", REPO, str(src))
    sha = sh("git", "rev-parse", "HEAD", cwd=src)
    atlas = src / "public" / "atlas"
    index = json.loads((atlas / "index.json").read_text("utf-8"))

    # 1. 词条：entries/<n>.json（100 条/片）按索引顺序合并
    entries = []
    n_chunks = (index["count"] + index["chunk"] - 1) // index["chunk"]
    for i in range(n_chunks):
        entries += json.loads((atlas / "entries" / f"{i}.json").read_text("utf-8"))
    assert len(entries) == index["count"], (len(entries), index["count"])

    out_dir = ROOT / "data" / "vocab" / "ielts"
    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True)
    words = [convert(e) for e in entries]
    for i in range(0, len(words), CHUNK):
        (out_dir / f"{i // CHUNK}.json").write_text(
            json.dumps(words[i:i + CHUNK], ensure_ascii=False, separators=(",", ":")), "utf-8")
    (out_dir / "index.json").write_text(
        json.dumps([w["word"].lower() for w in words], ensure_ascii=False, separators=(",", ":")), "utf-8")

    manifest_p = ROOT / "data" / "vocab" / "manifest.json"
    manifest = json.loads(manifest_p.read_text("utf-8"))
    assert manifest["chunkSize"] == CHUNK
    manifest["libs"]["ielts"] = {
        "name": "雅思·词光",
        "total": len(words),
        "chunks": (len(words) + CHUNK - 1) // CHUNK,
        "source": "Word Atlas contributors（词光）— CC BY 4.0",
    }
    manifest_p.write_text(json.dumps(manifest, ensure_ascii=False, separators=(",", ":")), "utf-8")

    # 2. 元信息与查找表
    atlas_out = ROOT / "data" / "atlas"
    atlas_out.mkdir(parents=True, exist_ok=True)
    lookup = {}
    for i, e in enumerate(entries):
        lookup.setdefault(e["w"].lower(), [e["id"], e.get("m", 0), i])
    (atlas_out / "lookup.json").write_text(json.dumps(lookup, ensure_ascii=False, separators=(",", ":")), "utf-8")
    meta = {
        "name": "Word Atlas Open（词光）",
        "upstream": "https://github.com/designfuchen/word-atlas",
        "commit": sha,
        "license": "CC BY 4.0 — Word Atlas contributors（词光）",
        "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
        "modified": "转换为 ListeningHub 词库格式；未修改释义、例句、插画与录音内容",
        "voiceNote": "单词与例句录音为 ElevenLabs 合成语音（英音 Alice / 美音 Sarah）",
        "media": {
            "thumb": "data/atlas/thumb/",
            "uk": "data/atlas/audio/uk/",
            "us": "data/atlas/audio/us/",
            "img": f"https://raw.githubusercontent.com/designfuchen/word-atlas/{sha}/public/atlas/img/",
            "ex": f"https://raw.githubusercontent.com/designfuchen/word-atlas/{sha}/public/atlas/audio/ex/",
            "ex2": f"https://raw.githubusercontent.com/designfuchen/word-atlas/{sha}/public/atlas/audio/ex2/",
        },
        "mediaBits": {"img": 1, "uk": 2, "us": 4, "ex": 8, "ex2": 16},
        "topics": dict(index["topics"]),
        "cefr": index["cefr"],
        "count": len(words),
    }
    (atlas_out / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), "utf-8")

    # 3. 本地托管的媒体
    if not args.no_media:
        for name, sub, pat in (("thumb", "thumb", "*.webp"), ("uk", "audio/uk", "*.mp3"), ("us", "audio/us", "*.mp3")):
            n, size = copy_tree(atlas / sub, atlas_out / sub, pat)
            print(f"媒体 {name}: {n} 个文件，{size / 1e6:.0f} MB")
    print(f"完成：{len(words)} 词，上游 commit {sha[:10]}")


if __name__ == "__main__":
    main()
