// 字幕解析：支持 LRC / SRT / VTT，自动识别中英双语行
const CJK = /[\u3400-\u9fff\uf900-\ufaff]/;

function toSec(h, m, s, ms) {
  return (+h || 0) * 3600 + (+m || 0) * 60 + (+s || 0) + (ms ? +(`0.${ms}`) : 0);
}

function cleanLine(s) {
  return s.replace(/<[^>]+>/g, '').replace(/\{[^}]+\}/g, '').replace(/\s+/g, ' ').trim();
}

// 一组文本行 → { en, zh }
function splitLang(lines) {
  const en = [];
  const zh = [];
  for (const raw of lines) {
    const line = cleanLine(raw);
    if (!line) continue;
    // "English / 中文" 或 "English | 中文" 同行双语
    const m = line.match(/^(.*?[A-Za-z].*?)\s*[/|｜]\s*(.*[\u3400-\u9fff].*)$/);
    if (m) { en.push(m[1]); zh.push(m[2]); continue; }
    (CJK.test(line) && !/[A-Za-z]{3,}/.test(line.replace(/[\u3400-\u9fff]/g, '')) ? zh : en).push(line);
  }
  return { en: en.join(' ').trim(), zh: zh.join(' ').trim() };
}

function parseSrtVtt(text) {
  const blocks = text.replace(/\r/g, '').replace(/^WEBVTT[^\n]*\n/, '').split(/\n{2,}/);
  const out = [];
  const re = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})\s*-->\s*(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/;
  for (const block of blocks) {
    const lines = block.split('\n');
    const idx = lines.findIndex(l => re.test(l));
    if (idx < 0) continue;
    const m = lines[idx].match(re);
    const { en, zh } = splitLang(lines.slice(idx + 1));
    if (!en) continue;
    out.push({ t0: toSec(m[1], m[2], m[3], m[4]), t1: toSec(m[5], m[6], m[7], m[8]), en, zh });
  }
  return out;
}

function parseLrc(text, duration) {
  const groups = new Map();
  const re = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const stamps = [...raw.matchAll(re)];
    if (!stamps.length) continue;
    const content = raw.replace(re, '').trim();
    if (!content) continue;
    for (const s of stamps) {
      const t = toSec(0, s[1], s[2], s[3]);
      const key = t.toFixed(2);
      if (!groups.has(key)) groups.set(key, { t, lines: [] });
      groups.get(key).lines.push(content);
    }
  }
  const items = [...groups.values()].sort((a, b) => a.t - b.t);
  const out = [];
  items.forEach((g, i) => {
    const { en, zh } = splitLang(g.lines);
    if (!en) {
      // 纯中文行附加到上一句
      if (zh && out.length) out[out.length - 1].zh = (out[out.length - 1].zh + ' ' + zh).trim();
      return;
    }
    const next = items[i + 1];
    out.push({ t0: g.t, t1: next ? next.t : (duration || g.t + 6), en, zh });
  });
  return out;
}

export function parseSubtitles(text, filename = '', duration = 0) {
  const name = filename.toLowerCase();
  let items;
  if (name.endsWith('.lrc') || (/^\s*\[\d{1,3}:\d{2}/m.test(text) && !text.includes('-->'))) {
    items = parseLrc(text, duration);
  } else {
    items = parseSrtVtt(text);
  }
  items = items.filter(s => s.t1 > s.t0 && s.en);
  return items.map((s, i) => ({
    id: i + 1,
    en: s.en,
    zh: s.zh || '',
    t0: Math.round(s.t0 * 100) / 100,
    t1: Math.round(s.t1 * 100) / 100,
  }));
}
