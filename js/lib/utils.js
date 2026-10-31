// 通用工具：本地存储、日期、文本处理
export function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn('localStorage 写入失败', key, e);
  }
}

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export const todayStr = () => ymd(new Date());
export function yesterdayStr() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return ymd(d);
}

export function formatTime(sec) {
  if (sec == null || isNaN(sec) || !isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatRelative(ts) {
  if (!ts) return '';
  const diff = ts - Date.now();
  const abs = Math.abs(diff);
  const H = 3600e3;
  const D = 24 * H;
  let text;
  if (abs < H) text = `${Math.max(1, Math.round(abs / 60e3))} 分钟`;
  else if (abs < D) text = `${Math.round(abs / H)} 小时`;
  else text = `${Math.round(abs / D)} 天`;
  return diff >= 0 ? `${text}后` : `${text}前`;
}

export function cleanWord(w) {
  return String(w || '').replace(/[’]/g, "'").replace(/[^a-zA-Z'-]/g, '').replace(/^'+|'+$/g, '').toLowerCase();
}

export function tokenize(text) {
  return String(text || '').split(/(\s+)/).map(p => ({
    raw: p,
    isWord: /[a-zA-Z]/.test(p),
    clean: cleanWord(p),
  }));
}

// 听写比对用的词序列：统一大小写、引号、数字千分位
export function normWords(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/(\d),(\d)/g, '$1$2')
    .replace(/[-–—]/g, ' ')
    .replace(/[^a-z0-9'\s]/g, ' ')
    .split(/\s+/)
    .map(w => w.replace(/^'+|'+$/g, ''))
    .filter(Boolean);
}

// 基于 LCS 的逐词对比，返回 { score, correct, total, diff: [{ word, ok, user? }] }
export function diffWords(answer, input) {
  const a = normWords(answer);
  const b = normWords(input);
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const diff = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      diff.push({ word: a[i], ok: true });
      i++; j++;
    } else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) {
      diff.push({ word: b[j], ok: false, extra: true });
      j++;
    } else {
      diff.push({ word: a[i], ok: false, missing: true });
      i++;
    }
  }
  const correct = dp[0][0];
  return { correct, total: n, score: n ? Math.round((correct / n) * 100) : 0, diff };
}

export function downloadText(filename, content, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}
