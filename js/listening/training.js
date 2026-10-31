// 听力训练流程：首学五阶段 + 7 轮间隔复习（参考 Echo Loop 的训练闭环）
import { loadJSON, saveJSON } from '../lib/utils.js';

const KEY = 'lh_training_v1';
const H = 3600e3;

export const STAGES = [
  { key: 'blind', name: '盲听', icon: '🎧', tip: '不看文稿，从头到尾听一遍，先抓大意和关键词。' },
  { key: 'intensive', name: '精听', icon: '🔍', tip: '逐句听，听不懂就循环、降速、看文稿，把卡住的句子标为难句。' },
  { key: 'dictation', name: '听写', icon: '✍️', tip: '把难句（没有难句时就选几句）逐句默写，对比找出没听出的弱读与连读。' },
  { key: 'shadow', name: '跟读', icon: '🗣️', tip: '逐句模仿语调、重音和停顿，录音后和原声对比。' },
  { key: 'retell', name: '复述', icon: '💬', tip: '只看关键词，用自己的话把内容说出来，录下来再对照原文。' },
];

// 首学完成后的复习间隔（小时）：6h → 1d → 2d → 4d → 7d → 14d → 28d
export const REVIEW_HOURS = [6, 24, 48, 96, 168, 336, 672];
export const REVIEW_STEPS = ['blind', 'hard', 'retell'];

let store = loadJSON(KEY, {});
const persist = () => saveJSON(KEY, store);

function blank() {
  return { stage: 0, hard: [], lastSentence: null, startedAt: 0, learnedAt: 0, reviewIdx: 0, nextReviewAt: 0, reviews: [] };
}

export function getState(id) {
  return { ...blank(), ...(store[id] || {}) };
}

function update(id, patch) {
  store[id] = { ...getState(id), ...patch };
  persist();
  return store[id];
}

export function touch(id, sentenceId) {
  const s = getState(id);
  return update(id, { startedAt: s.startedAt || Date.now(), lastSentence: sentenceId ?? s.lastSentence });
}

export function setStage(id, stage) {
  return update(id, { stage: Math.max(0, Math.min(STAGES.length, stage)) });
}

// 完成当前阶段；最后一个阶段完成后进入复习计划
export function completeStage(id) {
  const s = getState(id);
  const next = Math.min(STAGES.length, s.stage + 1);
  const patch = { stage: next, startedAt: s.startedAt || Date.now() };
  if (next === STAGES.length && !s.learnedAt) {
    patch.learnedAt = Date.now();
    patch.reviewIdx = 0;
    patch.nextReviewAt = Date.now() + REVIEW_HOURS[0] * H;
  }
  return update(id, patch);
}

export function completeReview(id) {
  const s = getState(id);
  const idx = s.reviewIdx + 1;
  const done = idx >= REVIEW_HOURS.length;
  return update(id, {
    reviewIdx: idx,
    nextReviewAt: done ? 0 : Date.now() + REVIEW_HOURS[idx] * H,
    reviews: [...s.reviews, Date.now()],
  });
}

export function toggleHard(id, sentenceId) {
  const s = getState(id);
  const hard = s.hard.includes(sentenceId) ? s.hard.filter(x => x !== sentenceId) : [...s.hard, sentenceId].sort((a, b) => a - b);
  return update(id, { hard });
}

export function resetEpisode(id) {
  delete store[id];
  persist();
}

export function status(id) {
  const s = getState(id);
  if (!s.startedAt) return { kind: 'new', label: '未开始' };
  if (!s.learnedAt) return { kind: 'learning', label: `首学 ${s.stage}/${STAGES.length}` };
  if (s.reviewIdx >= REVIEW_HOURS.length) return { kind: 'mastered', label: '已掌握' };
  if (s.nextReviewAt <= Date.now()) return { kind: 'due', label: `待复习 R${s.reviewIdx + 1}` };
  return { kind: 'scheduled', label: `R${s.reviewIdx + 1} 已排期` };
}

export function allStates() {
  return store;
}

export function dueIds() {
  const now = Date.now();
  return Object.entries(store)
    .filter(([, s]) => s.learnedAt && s.nextReviewAt && s.nextReviewAt <= now && s.reviewIdx < REVIEW_HOURS.length)
    .sort((a, b) => a[1].nextReviewAt - b[1].nextReviewAt)
    .map(([id]) => id);
}

export function hardList() {
  return Object.entries(store).flatMap(([id, s]) => (s.hard || []).map(sid => ({ epId: id, sentenceId: sid })));
}

export function reload() {
  store = loadJSON(KEY, {});
}
