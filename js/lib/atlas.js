// word-atlas（词光）数据访问 + 统一单词发音
// 发音优先级：词光录音（本地托管）→ Free Dictionary 录音 → 浏览器 TTS（仅单词兜底，听力素材从不使用 TTS）
import { fetchJSON } from './utils.js';

let metaP = null;
let lookupP = null;
const chunkCache = new Map();
const dictAudioCache = new Map();
let audioEl = null;

export function loadAtlasMeta() {
  if (!metaP) metaP = fetchJSON('data/atlas/meta.json').catch(() => null);
  return metaP;
}

function loadLookup() {
  if (!lookupP) lookupP = fetchJSON('data/atlas/lookup.json').catch(() => ({}));
  return lookupP;
}

export const BITS = { img: 1, uk: 2, us: 4, ex: 8, ex2: 16 };
export const hasMedia = (m, kind) => !!(m & BITS[kind]);

export async function atlasRef(word) {
  const lookup = await loadLookup();
  const r = lookup[String(word || '').toLowerCase()];
  return r ? { id: r[0], m: r[1], index: r[2] } : null;
}

export function mediaUrlSync(meta, id, kind) {
  if (!meta || !id) return '';
  const base = meta.media[kind];
  const ext = kind === 'img' || kind === 'thumb' ? '.webp' : '.mp3';
  return base + encodeURIComponent(id) + ext;
}

export async function mediaUrl(id, kind) {
  return mediaUrlSync(await loadAtlasMeta(), id, kind);
}

// 根据 atlas 序号读取完整词条（雅思词库分片，200 词/片）
export async function atlasEntryByIndex(index) {
  const chunk = Math.floor(index / 200);
  if (!chunkCache.has(chunk)) chunkCache.set(chunk, fetchJSON(`data/vocab/ielts/${chunk}.json`));
  const list = await chunkCache.get(chunk);
  return list[index % 200] || null;
}

export async function atlasEntry(word) {
  const ref = await atlasRef(word);
  if (!ref) return null;
  const entry = await atlasEntryByIndex(ref.index);
  return entry ? { ...entry, ref } : null;
}

export function playUrl(url) {
  if (!url) return Promise.reject(new Error('no url'));
  if (!audioEl) audioEl = new Audio();
  audioEl.pause();
  audioEl.src = url;
  return audioEl.play();
}

async function dictionaryAudio(word) {
  if (dictAudioCache.has(word)) return dictAudioCache.get(word);
  const p = fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`)
    .then(r => (r.ok ? r.json() : []))
    .then(list => {
      const phs = (list[0]?.phonetics || []).filter(p => p.audio);
      const us = phs.find(p => /-us\.mp3$/.test(p.audio));
      const uk = phs.find(p => /-uk\.mp3$/.test(p.audio));
      return { us: (us || phs[0])?.audio || '', uk: (uk || phs[0])?.audio || '' };
    })
    .catch(() => ({ us: '', uk: '' }));
  dictAudioCache.set(word, p);
  return p;
}

function tts(word, accent) {
  const synth = window.speechSynthesis;
  if (!synth) return;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(word);
  u.lang = accent === 'uk' ? 'en-GB' : 'en-US';
  const v = synth.getVoices().find(x => x.lang === u.lang);
  if (v) u.voice = v;
  u.rate = 0.9;
  synth.speak(u);
}

// 返回实际使用的来源：'atlas' | 'dict' | 'tts'
export async function pronounce(word, accent = 'us', fallbackUrl = '') {
  const w = String(word || '').trim();
  if (!w) return null;
  const ref = await atlasRef(w);
  if (ref && hasMedia(ref.m, accent)) {
    try { await playUrl(await mediaUrl(ref.id, accent)); return 'atlas'; } catch { /* 继续降级 */ }
  }
  const urls = [fallbackUrl, (await dictionaryAudio(w.toLowerCase()))[accent]].filter(Boolean);
  for (const u of urls) {
    try { await playUrl(u); return 'dict'; } catch { /* 继续降级 */ }
  }
  tts(w, accent);
  return 'tts';
}
