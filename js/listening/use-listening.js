// 听力模块：素材目录 / 真人音频分段播放 / 训练流程 / 听写 / 跟读 / 复述 / 本地导入
import { SegmentPlayer } from '../lib/segment-player.js';
import { parseSubtitles } from '../lib/subtitles.js';
import { materialsDB, requestPersist } from '../lib/idb.js';
import { fetchJSON, loadJSON, saveJSON, diffWords, formatRelative } from '../lib/utils.js';
import * as T from './training.js';

const { ref, reactive, computed, watch, nextTick, shallowRef } = Vue;
const PREF_KEY = 'lh_listen_prefs';
const epCache = new Map();

export function useListening(ctx) {
  const prefs = loadJSON(PREF_KEY, {});
  const savePrefs = () => saveJSON(PREF_KEY, {
    rate: rate.value, showZh: showZh.value, loop: loop.value, pauseEach: pauseEach.value,
  });

  // ── 目录 ────────────────────────────────────────────────────────────────────
  const catalog = ref([]);          // VOA 精选
  const materials = ref([]);        // 用户导入
  const catalogSource = ref('');
  const catalogError = ref('');
  const tab = ref('voa');           // voa | review | mine
  const search = ref('');
  const category = ref('all');
  const level = ref('all');
  const trainVersion = ref(0);      // 训练状态变化时递增，驱动重新计算
  const bump = () => { trainVersion.value++; };

  async function loadCatalog() {
    try {
      const idx = await fetchJSON('data/listening/index.json');
      catalog.value = idx.episodes.map(e => ({ ...e, kind: 'voa' }));
      catalogSource.value = idx.source;
    } catch (e) {
      catalogError.value = '素材目录加载失败，请检查网络后刷新';
    }
    await loadMaterials();
  }

  async function loadMaterials() {
    try {
      const list = await materialsDB.list();
      materials.value = list.sort((a, b) => b.createdAt - a.createdAt).map(m => ({
        id: m.id, title: m.title, titleZh: '', program: '我的素材', category: 'Mine', level: '',
        duration: m.duration, wpm: m.wpm || 0, sentenceCount: m.sentences.length, kind: 'local', date: '',
      }));
    } catch { materials.value = []; }
  }

  const categories = computed(() => {
    const seen = new Set();
    return catalog.value.filter(e => !seen.has(e.program) && seen.add(e.program)).map(e => ({ key: e.program, program: e.program }));
  });

  const statusOf = id => { trainVersion.value; return T.status(id); };

  const filtered = computed(() => {
    trainVersion.value;
    let list = tab.value === 'mine' ? materials.value : catalog.value;
    if (tab.value === 'review') {
      const due = new Set(T.dueIds());
      list = [...catalog.value, ...materials.value].filter(e => due.has(e.id));
    }
    if (tab.value === 'voa') {
      if (category.value !== 'all') list = list.filter(e => e.program === category.value);
      if (level.value !== 'all') list = list.filter(e => e.level === level.value);
    }
    const q = search.value.trim().toLowerCase();
    if (q) list = list.filter(e => `${e.title} ${e.titleZh || ''} ${e.program}`.toLowerCase().includes(q));
    return list;
  });

  const dueCount = computed(() => { trainVersion.value; return T.dueIds().length; });
  const learnedCount = computed(() => {
    trainVersion.value;
    return Object.values(T.allStates()).filter(s => s.learnedAt).length;
  });

  // ── 播放器 ──────────────────────────────────────────────────────────────────
  const player = new SegmentPlayer();
  const current = shallowRef(null);   // 当前篇完整数据
  const loading = ref(false);
  const loadError = ref('');
  const playing = ref(false);
  const time = ref(0);
  const duration = ref(0);
  const activeIdx = ref(-1);
  const mode = ref('idle');           // idle | range | continuous
  const rate = ref(prefs.rate || 1);
  const loop = ref(!!prefs.loop);
  const pauseEach = ref(!!prefs.pauseEach);
  const showZh = ref(prefs.showZh !== false);
  const revealText = ref(false);      // 盲听阶段临时显示文稿
  const audioError = ref('');
  let objectUrl = '';
  let pausedAtIdx = -1;

  player.setRate(rate.value);
  player.on('state', v => { playing.value = v; });
  player.on('meta', d => { duration.value = d; });
  player.on('error', e => {
    if (e && e.name === 'NotAllowedError') return;
    audioError.value = '音频加载失败，请检查网络或稍后重试';
  });
  player.on('ended', () => {
    if (current.value) ctx.recordEpisodeCompleted(current.value.id);
    mode.value = 'idle';
  });
  player.on('time', onTime);

  const sentences = computed(() => current.value?.sentences || []);
  const activeSentence = computed(() => sentences.value[activeIdx.value] || null);
  const train = computed(() => { trainVersion.value; return current.value ? T.getState(current.value.id) : null; });
  const hardSet = computed(() => new Set(train.value?.hard || []));
  const inReview = computed(() => !!(train.value?.learnedAt && train.value.nextReviewAt && train.value.nextReviewAt <= Date.now()));
  const stageKey = ref('intensive');  // 当前展示的训练阶段

  function findIdx(t) {
    const list = sentences.value;
    let lo = 0;
    let hi = list.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].t0 <= t + 0.05) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans;
  }

  function onTime(t) {
    time.value = t;
    if (mode.value !== 'continuous') return;
    const idx = findIdx(t);
    if (idx !== activeIdx.value && idx >= 0) {
      activeIdx.value = idx;
      ctx.recordSentencePlayed(current.value?.id);
    }
    const s = sentences.value[idx];
    if (pauseEach.value && s && t >= s.t1 - 0.03 && pausedAtIdx !== idx) {
      pausedAtIdx = idx;
      player.pause();
    }
  }

  async function resolveEpisode(meta) {
    if (meta.kind === 'local') {
      const m = await materialsDB.get(meta.id);
      const blob = await materialsDB.getAudio(meta.id);
      if (!m || !blob) throw new Error('本地素材不存在');
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = URL.createObjectURL(blob);
      return { ...meta, ...m, audio: objectUrl, audioRef: `idb:${meta.id}`, glossary: [], credits: [] };
    }
    if (!epCache.has(meta.id)) epCache.set(meta.id, fetchJSON(`data/listening/episodes/${meta.id}.json`));
    const ep = await epCache.get(meta.id);
    return { ...ep, kind: 'voa', audioRef: ep.audio };
  }

  async function openEpisode(meta) {
    if (current.value?.id === meta.id) return;
    player.stop();
    closeDictation();
    closeShadow();
    resetRetell();
    loading.value = true;
    loadError.value = '';
    audioError.value = '';
    try {
      const ep = await resolveEpisode(meta);
      current.value = ep;
      duration.value = ep.duration || 0;
      time.value = 0;
      mode.value = 'idle';
      revealText.value = false;
      player.load(ep.audio);
      const st = T.getState(ep.id);
      const last = st.lastSentence ? ep.sentences.findIndex(s => s.id === st.lastSentence) : -1;
      activeIdx.value = last;
      if (st.learnedAt && st.nextReviewAt && st.nextReviewAt <= Date.now()) stageKey.value = 'blind';
      else stageKey.value = T.STAGES[Math.min(st.stage, T.STAGES.length - 1)].key;
      if (window.innerWidth < 1024) ctx.onEpisodeOpened && ctx.onEpisodeOpened();
    } catch (e) {
      loadError.value = String(e.message || e);
    } finally {
      loading.value = false;
    }
  }

  function closeEpisode() {
    player.stop();
    current.value = null;
  }

  function playSentence(s, opts = {}) {
    if (!s || !current.value) return;
    audioError.value = '';
    mode.value = 'range';
    activeIdx.value = sentences.value.indexOf(s);
    T.touch(current.value.id, s.id);
    ctx.recordSentencePlayed(current.value.id);
    return player.playRange(s.t0, s.t1, { loop: opts.loop ?? loop.value, onEnd: opts.onEnd });
  }

  function playContinuous(fromIdx) {
    if (!current.value) return;
    audioError.value = '';
    const idx = fromIdx ?? (activeIdx.value >= 0 ? activeIdx.value : 0);
    const s = sentences.value[idx];
    mode.value = 'continuous';
    pausedAtIdx = -1;
    activeIdx.value = idx;
    if (s) T.touch(current.value.id, s.id);
    return player.playFrom(s ? s.t0 : 0);
  }

  function playAll() {
    pauseEach.value = false;
    return playContinuous(0);
  }

  function togglePlay() {
    if (!current.value) return;
    if (playing.value) return player.pause();
    if (mode.value === 'range' && player.range) return player.resume();
    if (mode.value === 'continuous') {
      pausedAtIdx = -1;
      const next = pauseEach.value ? Math.min(activeIdx.value + 1, sentences.value.length - 1) : null;
      if (pauseEach.value && next != null && time.value >= (sentences.value[activeIdx.value]?.t1 ?? 0) - 0.05) return playContinuous(next);
      return player.resume();
    }
    if (activeSentence.value) return playSentence(activeSentence.value);
    return playContinuous(0);
  }

  function step(delta) {
    if (!sentences.value.length) return;
    const idx = Math.max(0, Math.min(sentences.value.length - 1, (activeIdx.value < 0 ? -1 : activeIdx.value) + delta));
    if (mode.value === 'continuous') return playContinuous(idx);
    return playSentence(sentences.value[idx]);
  }

  function replay() {
    if (activeSentence.value) playSentence(activeSentence.value);
  }

  function seekRatio(e) {
    if (!duration.value) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const t = ((e.clientX - rect.left) / rect.width) * duration.value;
    mode.value = 'continuous';
    pausedAtIdx = -1;
    if (playing.value) player.playFrom(t); else { player.seek(t); time.value = t; activeIdx.value = findIdx(t); }
  }

  function setRate(r) {
    rate.value = r;
    player.setRate(r);
    savePrefs();
  }

  watch([showZh, loop, pauseEach], savePrefs);
  watch(loop, v => { if (player.range) player.range.loop = v; });
  watch(activeIdx, idx => {
    const s = sentences.value[idx];
    if (!s || mode.value !== 'continuous') return;
    nextTick(() => {
      const el = document.getElementById(`sent-${s.id}`);
      if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  });

  // ── 训练阶段 ────────────────────────────────────────────────────────────────
  function setStage(key) {
    stageKey.value = key;
    revealText.value = false;
    if (key === 'dictation') startDictation();
    if (key === 'retell') resetRetell();
  }

  function completeStage() {
    if (!current.value) return;
    const id = current.value.id;
    const before = T.getState(id);
    const idx = T.STAGES.findIndex(s => s.key === stageKey.value);
    if (idx >= before.stage) T.setStage(id, idx);
    const st = T.completeStage(id);
    if (stageKey.value === 'blind') ctx.recordEpisodeCompleted(id);
    bump();
    if (st.stage >= T.STAGES.length) {
      ctx.toast(before.learnedAt ? '本阶段完成' : `首学完成！${formatRelative(st.nextReviewAt)}进行第 1 轮复习`);
      stageKey.value = 'retell';
    } else {
      stageKey.value = T.STAGES[st.stage].key;
      if (stageKey.value === 'dictation') startDictation();
    }
  }

  function finishReview() {
    if (!current.value) return;
    const st = T.completeReview(current.value.id);
    bump();
    ctx.toast(st.nextReviewAt ? `第 ${st.reviewIdx} 轮复习完成，${formatRelative(st.nextReviewAt)}再来` : '7 轮复习全部完成，这篇已经掌握了 🎉');
  }

  function toggleHard(s) {
    if (!current.value || !s) return;
    T.toggleHard(current.value.id, s.id);
    bump();
  }

  function resetProgress() {
    if (!current.value) return;
    T.resetEpisode(current.value.id);
    stageKey.value = 'blind';
    bump();
  }

  const keywords = computed(() => {
    const ep = current.value;
    if (!ep) return [];
    if (ep.glossary?.length) return ep.glossary.map(g => g.term);
    const stop = new Set('the a an and or but of to in on at for with from by as is are was were be been it this that these those he she they we you i his her their our its not have has had will would can could said says about into over after before more most than then there which who what when where how also just very some many such other'.split(' '));
    const freq = new Map();
    ep.sentences.forEach(s => s.en.toLowerCase().replace(/[^a-z\s-]/g, ' ').split(/\s+/).forEach(w => {
      if (w.length > 4 && !stop.has(w)) freq.set(w, (freq.get(w) || 0) + 1);
    }));
    return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([w]) => w);
  });

  // ── 听写 ────────────────────────────────────────────────────────────────────
  const dictation = reactive({ active: false, queue: [], pos: 0, input: '', result: null, scores: [] });
  const dictSentence = computed(() => sentences.value.find(s => s.id === dictation.queue[dictation.pos]) || null);

  function startDictation(ids) {
    if (!current.value) return;
    const hard = train.value?.hard || [];
    let queue = ids || (hard.length ? hard : sentences.value.filter((_, i) => i % 3 === 0).slice(0, 8).map(s => s.id));
    if (!queue.length) queue = sentences.value.slice(0, 5).map(s => s.id);
    Object.assign(dictation, { active: true, queue: [...queue], pos: 0, input: '', result: null, scores: [] });
    nextTick(() => dictPlay());
  }
  function dictPlay(r) {
    const s = dictSentence.value;
    if (!s) return;
    if (r) player.setRate(r);
    playSentence(s, { loop: false, onEnd: () => player.setRate(rate.value) });
  }
  function dictSubmit() {
    const s = dictSentence.value;
    if (!s || !dictation.input.trim()) return;
    dictation.result = diffWords(s.en, dictation.input);
    dictation.scores[dictation.pos] = dictation.result.score;
    if (dictation.result.score < 80 && !hardSet.value.has(s.id)) toggleHard(s);
  }
  function dictNext() {
    if (dictation.pos < dictation.queue.length - 1) {
      dictation.pos++;
      dictation.input = '';
      dictation.result = null;
      nextTick(() => dictPlay());
    } else {
      dictation.active = false;
      const avg = Math.round(dictation.scores.reduce((a, b) => a + (b || 0), 0) / Math.max(1, dictation.scores.length));
      ctx.toast(`听写完成，平均 ${avg} 分`);
    }
  }
  function closeDictation() { dictation.active = false; }

  // ── 跟读 ────────────────────────────────────────────────────────────────────
  const shadow = reactive({ active: false, sentenceId: null, recording: false, url: '', error: '', comparing: false });
  const shadowSentence = computed(() => sentences.value.find(s => s.id === shadow.sentenceId) || null);
  let recorder = null;
  let chunks = [];
  let recStream = null;
  const recAudio = new Audio();

  async function startRecorder(onDone) {
    try {
      recStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return '无法访问麦克风，请在浏览器地址栏允许麦克风权限';
    }
    chunks = [];
    recorder = new MediaRecorder(recStream);
    recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
      recStream.getTracks().forEach(t => t.stop());
      onDone(URL.createObjectURL(blob));
    };
    recorder.start();
    return '';
  }
  function stopRecorder() { if (recorder && recorder.state !== 'inactive') recorder.stop(); }

  function openShadow(s) {
    const target = s || activeSentence.value || sentences.value[0];
    if (!target) return;
    closeShadow();
    Object.assign(shadow, { active: true, sentenceId: target.id, recording: false, url: '', error: '' });
    playSentence(target, { loop: false });
  }
  function shadowNav(delta) {
    const i = sentences.value.findIndex(s => s.id === shadow.sentenceId) + delta;
    if (i >= 0 && i < sentences.value.length) openShadow(sentences.value[i]);
  }
  async function shadowRecord() {
    if (shadow.recording) { stopRecorder(); shadow.recording = false; return; }
    player.pause();
    if (shadow.url) URL.revokeObjectURL(shadow.url);
    shadow.url = '';
    shadow.error = await startRecorder(url => { shadow.url = url; });
    shadow.recording = !shadow.error;
  }
  function shadowPlayMine() {
    if (!shadow.url) return;
    recAudio.src = shadow.url;
    recAudio.play().catch(() => {});
  }
  function shadowCompare() {
    const s = shadowSentence.value;
    if (!s || !shadow.url) return;
    playSentence(s, { loop: false, onEnd: () => setTimeout(shadowPlayMine, 300) });
  }
  function closeShadow() {
    if (shadow.recording) stopRecorder();
    if (shadow.url) URL.revokeObjectURL(shadow.url);
    Object.assign(shadow, { active: false, sentenceId: null, recording: false, url: '', error: '' });
  }

  // ── 复述 ────────────────────────────────────────────────────────────────────
  const retell = reactive({ recording: false, url: '', error: '', reveal: false, seconds: 0 });
  let retellTimer = 0;
  async function retellRecord() {
    if (retell.recording) {
      stopRecorder();
      retell.recording = false;
      clearInterval(retellTimer);
      return;
    }
    player.pause();
    if (retell.url) URL.revokeObjectURL(retell.url);
    retell.url = '';
    retell.seconds = 0;
    retell.error = await startRecorder(url => { retell.url = url; });
    retell.recording = !retell.error;
    if (retell.recording) retellTimer = setInterval(() => { retell.seconds++; }, 1000);
  }
  function retellPlay() {
    if (!retell.url) return;
    recAudio.src = retell.url;
    recAudio.play().catch(() => {});
  }
  function resetRetell() {
    if (retell.recording) stopRecorder();
    clearInterval(retellTimer);
    if (retell.url) URL.revokeObjectURL(retell.url);
    Object.assign(retell, { recording: false, url: '', error: '', reveal: false, seconds: 0 });
  }

  // ── 难句本 ──────────────────────────────────────────────────────────────────
  const hardItems = ref([]);
  async function loadHardItems() {
    const list = T.hardList();
    const all = [...catalog.value, ...materials.value];
    const out = [];
    for (const { epId, sentenceId } of list) {
      const meta = all.find(e => e.id === epId);
      if (!meta) continue;
      try {
        const ep = meta.kind === 'local' ? await materialsDB.get(epId) : await (epCache.get(epId) || (epCache.set(epId, fetchJSON(`data/listening/episodes/${epId}.json`)), epCache.get(epId)));
        const s = ep?.sentences.find(x => x.id === sentenceId);
        if (s) out.push({ meta, sentence: s });
      } catch { /* 忽略 */ }
    }
    hardItems.value = out;
  }
  async function playHardItem(item) {
    await openEpisode(item.meta);
    const s = sentences.value.find(x => x.id === item.sentence.id);
    stageKey.value = 'intensive';
    if (s) playSentence(s);
  }
  watch(tab, v => { if (v === 'review') loadHardItems(); });

  // ── 导入本地素材 ────────────────────────────────────────────────────────────
  const importer = reactive({ open: false, audio: null, sub: null, title: '', error: '', busy: false });
  function openImporter() { Object.assign(importer, { open: true, audio: null, sub: null, title: '', error: '', busy: false }); }
  function pickAudio(file) {
    importer.audio = file || null;
    if (file && !importer.title) importer.title = file.name.replace(/\.[^.]+$/, '');
  }
  function audioDuration(file) {
    return new Promise(resolve => {
      const a = new Audio();
      const url = URL.createObjectURL(file);
      a.preload = 'metadata';
      a.onloadedmetadata = () => { resolve(a.duration || 0); URL.revokeObjectURL(url); };
      a.onerror = () => { resolve(0); URL.revokeObjectURL(url); };
      a.src = url;
    });
  }
  async function saveImport() {
    if (!importer.audio || !importer.sub) { importer.error = '请同时选择音频和字幕文件'; return; }
    importer.busy = true;
    importer.error = '';
    try {
      const dur = await audioDuration(importer.audio);
      const text = await importer.sub.text();
      const sents = parseSubtitles(text, importer.sub.name, dur);
      if (sents.length < 2) throw new Error('字幕里没有解析到带时间轴的句子，请确认是 LRC / SRT / VTT 格式');
      const words = sents.reduce((n, s) => n + s.en.split(/\s+/).length, 0);
      const speech = sents.reduce((n, s) => n + (s.t1 - s.t0), 0) || 1;
      const id = `local-${Date.now().toString(36)}`;
      await materialsDB.put({
        id, title: importer.title || importer.audio.name, createdAt: Date.now(), duration: dur,
        wpm: Math.round((words / speech) * 60), sentences: sents, audioName: importer.audio.name,
      }, importer.audio);
      requestPersist();
      await loadMaterials();
      importer.open = false;
      tab.value = 'mine';
      ctx.toast(`已导入 ${sents.length} 句`);
    } catch (e) {
      importer.error = String(e.message || e);
    } finally {
      importer.busy = false;
    }
  }
  async function removeMaterial(meta) {
    if (!confirm(`删除「${meta.title}」？音频和字幕会从本机移除。`)) return;
    if (current.value?.id === meta.id) closeEpisode();
    await materialsDB.remove(meta.id);
    T.resetEpisode(meta.id);
    bump();
    await loadMaterials();
  }

  // ── 快捷键 ──────────────────────────────────────────────────────────────────
  function onKey(e) {
    if (!current.value) return false;
    if (dictation.active) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); dictation.result ? dictNext() : dictSubmit(); return true; }
      if (e.key === 'Tab') { e.preventDefault(); dictPlay(); return true; }
      return false;
    }
    if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return false;
    const k = e.key.toLowerCase();
    if (e.key === ' ') { e.preventDefault(); togglePlay(); return true; }
    if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); return true; }
    if (e.key === 'ArrowRight') { e.preventDefault(); step(1); return true; }
    if (k === 'r') { replay(); return true; }
    if (k === 'l') { loop.value = !loop.value; return true; }
    if (k === 'h' && activeSentence.value) { toggleHard(activeSentence.value); return true; }
    if (k === 'z') { showZh.value = !showZh.value; return true; }
    return false;
  }

  function wordContext(sentence) {
    const ep = current.value;
    if (!ep || !sentence) return {};
    return { epId: ep.id, epTitle: ep.title, sentenceId: sentence.id, en: sentence.en, t0: sentence.t0, t1: sentence.t1, audioRef: ep.audioRef };
  }

  function stopAll() { player.pause(); }

  return {
    // 目录
    catalog, materials, catalogSource, catalogError, tab, search, category, level, categories, filtered,
    statusOf, dueCount, learnedCount, loadCatalog, trainVersion,
    // 播放
    current, loading, loadError, audioError, playing, time, duration, activeIdx, activeSentence, sentences, mode,
    rate, loop, pauseEach, showZh, revealText, openEpisode, closeEpisode, playSentence, playContinuous, playAll,
    togglePlay, step, replay, seekRatio, setRate, stopAll,
    // 训练
    STAGES: T.STAGES, REVIEW_HOURS: T.REVIEW_HOURS, stageKey, setStage, completeStage, finishReview, train, hardSet,
    inReview, toggleHard, resetProgress, keywords,
    // 听写 / 跟读 / 复述
    dictation, dictSentence, startDictation, dictPlay, dictSubmit, dictNext, closeDictation,
    shadow, shadowSentence, openShadow, shadowNav, shadowRecord, shadowPlayMine, shadowCompare, closeShadow,
    retell, retellRecord, retellPlay, resetRetell,
    // 难句 / 导入
    hardItems, loadHardItems, playHardItem,
    importer, openImporter, pickAudio, saveImport, removeMaterial,
    onKey, wordContext, formatRelative,
  };
}

// 生词本里回放原句：VOA 素材直接用路径；本地素材从 IndexedDB 取音频
export async function resolveAudioRef(ref) {
  if (!ref) return '';
  if (!ref.startsWith('idb:')) return ref;
  const blob = await materialsDB.getAudio(ref.slice(4));
  return blob ? URL.createObjectURL(blob) : '';
}
