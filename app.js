// Listening Hub 入口：主题 / 打卡进度 / 成就 / 生词本 + 查词 + SRS，组合听力与背单词模块
import { loadJSON, saveJSON, todayStr, yesterdayStr, formatTime, tokenize, cleanWord, downloadText } from './js/lib/utils.js';
import { atlasRef, atlasEntryByIndex, loadAtlasMeta, mediaUrlSync, hasMedia, pronounce } from './js/lib/atlas.js';
import { playClip, stopClip } from './js/lib/segment-player.js';
import { useListening, resolveAudioRef } from './js/listening/use-listening.js';
import { useVocabTrainer } from './js/vocab/use-vocab-trainer.js';

const { createApp, ref, reactive, computed, onMounted, onUnmounted } = Vue;

const VOCAB_KEY = 'voa_vocabulary';
const THEME_KEY = 'voa_theme';
const PROGRESS_KEY = 'voa_progress';

function loadProgress() {
  const raw = loadJSON(PROGRESS_KEY, {});
  return {
    sentencesPlayed: raw.sentencesPlayed || 0,
    episodesStarted: raw.episodesStarted || {},
    episodesCompleted: raw.episodesCompleted || {},
    studyDays: raw.studyDays || {},
    lastStudyDate: raw.lastStudyDate || '',
    streak: raw.streak || 0,
  };
}

// 免费翻译（MyMemory），仅用于没有内置译文的单词
const translateCache = new Map();
async function translateToChinese(text) {
  if (translateCache.has(text)) return translateCache.get(text);
  try {
    const res = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|zh-CN`);
    const zh = (await res.json())?.responseData?.translatedText || '';
    translateCache.set(text, zh);
    return zh;
  } catch {
    return '';
  }
}

async function fetchWordInfo(word) {
  const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
  if (!res.ok) throw new Error('Not found');
  const entry = (await res.json())[0];
  let phonetic = '';
  let audioUrl = '';
  for (const p of entry.phonetics || []) {
    if (p.text && !phonetic) phonetic = p.text;
    if (p.audio && !audioUrl) audioUrl = p.audio;
  }
  const meanings = (entry.meanings || []).slice(0, 3).map(m => ({
    partOfSpeech: m.partOfSpeech,
    definition: m.definitions?.[0]?.definition || '',
    example: m.definitions?.[0]?.example || '',
  }));
  return { word: entry.word || word, phonetic, audioUrl, meanings };
}

// 简易词形还原：rescued → rescue，studies → study …（只用于匹配词光词条）
function lemmaCandidates(w) {
  const c = [w];
  const add = x => { if (x && x.length > 2 && !c.includes(x)) c.push(x); };
  if (w.endsWith('ies')) add(w.slice(0, -3) + 'y');
  if (w.endsWith('ied')) add(w.slice(0, -3) + 'y');
  if (w.endsWith('es')) add(w.slice(0, -2));
  if (w.endsWith('s') && !w.endsWith('ss')) add(w.slice(0, -1));
  if (w.endsWith('ed')) { add(w.slice(0, -2)); add(w.slice(0, -1)); if (/(.)\1ed$/.test(w)) add(w.slice(0, -3)); }
  if (w.endsWith('ing')) { add(w.slice(0, -3)); add(w.slice(0, -3) + 'e'); if (/(.)\1ing$/.test(w)) add(w.slice(0, -4)); }
  if (w.endsWith('er')) add(w.slice(0, -2));
  if (w.endsWith('est')) add(w.slice(0, -3));
  if (w.endsWith('ly')) add(w.slice(0, -2));
  if (w.endsWith("'s")) add(w.slice(0, -2));
  return c;
}

createApp({
  setup() {
    const view = ref('home');
    const sidebarOpen = ref(true);
    const statsModalOpen = ref(false);
    const vocabOpen = ref(false);
    const hardOpen = ref(false);

    // ── Toast ──────────────────────────────────────────────────────────────────
    const toastState = reactive({ show: false, msg: '' });
    let toastTimer = 0;
    function toast(msg) {
      toastState.msg = msg;
      toastState.show = true;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { toastState.show = false; }, 2800);
    }

    // ── Theme ─────────────────────────────────────────────────────────────────
    const theme = ref(localStorage.getItem(THEME_KEY) || 'light');
    function setTheme(t) {
      theme.value = t;
      document.documentElement.setAttribute('data-theme', t);
      localStorage.setItem(THEME_KEY, t);
    }
    document.documentElement.setAttribute('data-theme', theme.value);

    // ── Progress / 打卡 ───────────────────────────────────────────────────────
    const progress = ref(loadProgress());
    const saveProgress = () => saveJSON(PROGRESS_KEY, progress.value);
    function recordStudy() {
      const p = progress.value;
      const today = todayStr();
      p.studyDays[today] = (p.studyDays[today] || 0) + 1;
      if (p.lastStudyDate !== today) {
        p.streak = p.lastStudyDate === yesterdayStr() ? (p.streak || 0) + 1 : 1;
        p.lastStudyDate = today;
      }
      saveProgress();
    }
    function recordSentencePlayed(epId) {
      const p = progress.value;
      p.sentencesPlayed += 1;
      if (epId && !p.episodesStarted[epId]) p.episodesStarted[epId] = Date.now();
      recordStudy();
    }
    function recordEpisodeCompleted(epId) {
      if (!epId) return;
      progress.value.episodesCompleted[epId] = progress.value.episodesCompleted[epId] || Date.now();
      saveProgress();
    }

    // ── 生词本 ────────────────────────────────────────────────────────────────
    const vocabulary = ref(loadJSON(VOCAB_KEY, {}));
    const saveVocab = () => saveJSON(VOCAB_KEY, vocabulary.value);
    const vocabList = computed(() => Object.values(vocabulary.value).sort((a, b) => b.addedAt - a.addedAt));
    const vocabCount = computed(() => vocabList.value.length);
    function addVocabItem(item) {
      const key = item.word.toLowerCase();
      if (vocabulary.value[key]) return;
      vocabulary.value = { ...vocabulary.value, [key]: { ...item, addedAt: Date.now() } };
      saveVocab();
    }
    function removeFromVocab(word) {
      const next = { ...vocabulary.value };
      delete next[word.toLowerCase()];
      vocabulary.value = next;
      saveVocab();
    }
    const isWordSaved = word => !!vocabulary.value[cleanWord(word)];

    // ── 组合模块 ──────────────────────────────────────────────────────────────
    const L = useListening({
      recordSentencePlayed, recordEpisodeCompleted, toast,
      onEpisodeOpened: () => { sidebarOpen.value = false; },
    });

    // ── SRS（SM-2 简化），背单词拼写模式共用 ────────────────────────────────────
    function initSRS(item) {
      if (item.srsLevel === undefined) Object.assign(item, { srsLevel: 0, srsEase: 2.5, nextReviewAt: Date.now(), lastReviewAt: 0 });
      return item;
    }
    function applySRSQuality(item, quality) {
      initSRS(item);
      const DAY = 864e5;
      const base = [60e3, 6 * 60e3, DAY, 3 * DAY, 7 * DAY, 21 * DAY, 60 * DAY];
      if (quality === 0) {
        item.srsLevel = 0;
        item.srsEase = Math.max(1.3, item.srsEase - 0.2);
      } else {
        item.srsLevel = Math.min(6, item.srsLevel + (quality === 1 ? 0 : 1));
        item.srsEase = Math.max(1.3, item.srsEase + (quality - 1) * 0.1);
      }
      item.nextReviewAt = Date.now() + base[Math.min(item.srsLevel, base.length - 1)] * item.srsEase;
      item.lastReviewAt = Date.now();
    }

    const V = useVocabTrainer({ vocabulary, saveVocab, addVocabItem, applySRSQuality, recordStudy });

    const srsActive = ref(false);
    const srsCurrent = ref(null);
    const srsShowAnswer = ref(false);
    const srsQueue = ref([]);
    const dueReviewCount = computed(() => vocabList.value.filter(v => !v.nextReviewAt || v.nextReviewAt <= Date.now()).length);
    function startSRS() {
      const due = vocabList.value.filter(v => !v.nextReviewAt || v.nextReviewAt <= Date.now());
      if (!due.length) return;
      srsQueue.value = [...due].sort(() => Math.random() - 0.5);
      srsCurrent.value = srsQueue.value[0];
      srsShowAnswer.value = false;
      srsActive.value = true;
      vocabOpen.value = false;
    }
    function rateSRS(quality) {
      const item = srsCurrent.value && vocabulary.value[srsCurrent.value.word.toLowerCase()];
      if (!item) return;
      applySRSQuality(item, quality);
      saveVocab();
      srsQueue.value.shift();
      srsCurrent.value = srsQueue.value[0] || null;
      srsShowAnswer.value = false;
      if (!srsCurrent.value) stopClip();
    }
    function closeSRS() {
      srsActive.value = false;
      srsCurrent.value = null;
      srsQueue.value = [];
      stopClip();
    }

    // 回放生词所在的原句（真人音频片段）
    async function playContext(item) {
      const c = item?.context;
      if (!c?.audioRef) return;
      const src = await resolveAudioRef(c.audioRef);
      if (src) playClip(src, c.t0, c.t1);
      else toast('原句音频已不在本机（本地素材可能已删除）');
    }

    // ── 查词弹窗 ──────────────────────────────────────────────────────────────
    const atlasMeta = ref(null);
    loadAtlasMeta().then(m => { atlasMeta.value = m; });
    const popup = reactive({
      visible: false, loading: false, error: false, word: '', data: null,
      translation: '', translationLoading: false, atlas: null, context: null,
    });

    async function findAtlas(word) {
      for (const cand of lemmaCandidates(word)) {
        const ref0 = await atlasRef(cand);
        if (ref0) return { ...(await atlasEntryByIndex(ref0.index)), ref: ref0 };
      }
      return null;
    }

    async function openWordPopup(rawWord, sentence) {
      const word = cleanWord(rawWord);
      if (!word || word.length < 2) return;
      L.stopAll();
      Object.assign(popup, {
        visible: true, loading: true, error: false, data: null, translation: '', translationLoading: true,
        word, atlas: null, context: sentence ? L.wordContext(sentence) : null,
      });
      const [dictRes, atlasRes] = await Promise.allSettled([fetchWordInfo(word), findAtlas(word)]);
      if (popup.word !== word) return;
      popup.atlas = atlasRes.status === 'fulfilled' ? atlasRes.value : null;
      popup.loading = false;
      if (dictRes.status === 'fulfilled') popup.data = dictRes.value;
      else if (!popup.atlas) popup.error = true;
      if (popup.atlas) {
        popup.translation = popup.atlas.translations.map(t => `${t.type} ${t.translation}`).join('；');
        popup.translationLoading = false;
        if (!popup.data) {
          popup.data = {
            word: popup.atlas.word, phonetic: popup.atlas.us ? `/${popup.atlas.us}/` : '', audioUrl: '',
            meanings: popup.atlas.translations.map((t, i) => ({ partOfSpeech: t.type, definition: popup.atlas.atlas.defs[i] || '', example: '' })),
          };
        }
      } else {
        popup.translation = await translateToChinese(word);
        popup.translationLoading = false;
      }
    }
    const closePopup = () => { popup.visible = false; };
    const popupImg = computed(() => {
      const a = popup.atlas?.atlas;
      return a && atlasMeta.value && hasMedia(a.m, 'img') ? mediaUrlSync(atlasMeta.value, a.id, 'thumb') : '';
    });
    function playPopupAudio(accent = 'us') {
      pronounce(popup.atlas?.word || popup.data?.word || popup.word, accent, popup.data?.audioUrl);
    }
    function addToVocab() {
      const d = popup.data;
      const a = popup.atlas;
      const word = a?.word || d?.word || popup.word;
      addVocabItem({
        word,
        phonetic: d?.phonetic || (a?.us ? `/${a.us}/` : ''),
        audioUrl: d?.audioUrl || '',
        meanings: d?.meanings || [],
        translation: popup.translation || '',
        atlasId: a?.atlas?.id || '',
        fromEpisode: popup.context?.epId || '',
        fromSentenceId: popup.context?.sentenceId ?? null,
        context: popup.context,
      });
      popup.visible = false;
    }
    function vocabThumb(item) {
      if (!item.atlasId || !atlasMeta.value) return '';
      return mediaUrlSync(atlasMeta.value, item.atlasId, 'thumb');
    }
    const playVocabAudio = item => pronounce(item.word, 'us', item.audioUrl);
    function getEpTitle(epId, item) {
      const all = [...L.catalog.value, ...L.materials.value];
      return all.find(e => e.id === epId)?.title || item?.context?.epTitle || epId;
    }

    // ── 导出 ──────────────────────────────────────────────────────────────────
    function exportVocabAnki() {
      const lines = vocabList.value.map(v => {
        const parts = [v.phonetic, v.translation, (v.meanings || []).map(m => `[${m.partOfSpeech}] ${m.definition}`).join(' · ')];
        if (v.context?.en) parts.push(`原句：${v.context.en}`);
        return `${v.word}\t${parts.filter(Boolean).join(' | ').replace(/\t/g, ' ')}`;
      });
      downloadText(`vocabulary-${todayStr()}.txt`, lines.join('\n'));
    }
    function exportVocabCSV() {
      const header = 'Word,Phonetic,Translation,Meanings,Context,From Episode,Added At';
      const rows = vocabList.value.map(v => [
        v.word, v.phonetic || '', v.translation || '',
        (v.meanings || []).map(m => `[${m.partOfSpeech}] ${m.definition}`).join(' | '),
        v.context?.en || '', getEpTitle(v.fromEpisode, v) || '', new Date(v.addedAt || Date.now()).toISOString(),
      ].map(c => `"${String(c).replace(/"/g, '""')}"`).join(','));
      downloadText(`vocabulary-${todayStr()}.csv`, '\ufeff' + header + '\n' + rows.join('\n'), 'text/csv;charset=utf-8');
    }

    // ── 统计与成就 ────────────────────────────────────────────────────────────
    const progressStats = computed(() => {
      const p = progress.value;
      L.trainVersion.value;
      return {
        sentencesPlayed: p.sentencesPlayed,
        episodesStartedCount: Object.keys(p.episodesStarted).length,
        episodesCompletedCount: Object.keys(p.episodesCompleted).length,
        learned: L.learnedCount.value,
        streak: p.streak,
        todayCount: p.studyDays[todayStr()] || 0,
        totalDays: Object.keys(p.studyDays || {}).length,
      };
    });
    const ACHIEVEMENTS = [
      { id: 'streak_3', icon: '🌱', name: '初学者', desc: '连续学习 3 天', check: p => p.streak >= 3 },
      { id: 'streak_7', icon: '🔥', name: '坚持一周', desc: '连续学习 7 天', check: p => p.streak >= 7 },
      { id: 'streak_30', icon: '⭐', name: '月度达人', desc: '连续学习 30 天', check: p => p.streak >= 30 },
      { id: 'streak_100', icon: '💎', name: '百日坚持', desc: '连续学习 100 天', check: p => p.streak >= 100 },
      { id: 'days_10', icon: '📅', name: '学习10天', desc: '累计学习 10 天', check: p => p.totalDays >= 10 },
      { id: 'days_30', icon: '📆', name: '学习30天', desc: '累计学习 30 天', check: p => p.totalDays >= 30 },
      { id: 'sent_1', icon: '👂', name: '初次听力', desc: '听完第 1 句', check: p => p.sentencesPlayed >= 1 },
      { id: 'sent_100', icon: '🎧', name: '百句达成', desc: '累计听 100 句', check: p => p.sentencesPlayed >= 100 },
      { id: 'sent_1000', icon: '🎵', name: '千句大师', desc: '累计听 1000 句', check: p => p.sentencesPlayed >= 1000 },
      { id: 'ep_1', icon: '👣', name: '第一步', desc: '完整听完 1 篇', check: p => p.episodesCompletedCount >= 1 },
      { id: 'learn_1', icon: '🧭', name: '五步首学', desc: '完成 1 篇五步首学', check: p => p.learned >= 1 },
      { id: 'learn_20', icon: '🚀', name: '进阶学者', desc: '完成 20 篇五步首学', check: p => p.learned >= 20 },
      { id: 'vocab_10', icon: '📝', name: '收词新手', desc: '收藏 10 个生词', check: (p, v) => v >= 10 },
      { id: 'vocab_50', icon: '📚', name: '词汇达人', desc: '收藏 50 个生词', check: (p, v) => v >= 50 },
      { id: 'vocab_200', icon: '🏆', name: '词汇大师', desc: '收藏 200 个生词', check: (p, v) => v >= 200 },
    ];
    const achievements = computed(() => ACHIEVEMENTS.map(a => ({ ...a, unlocked: a.check(progressStats.value, vocabCount.value) })));
    const achievementUnlockedCount = computed(() => achievements.value.filter(a => a.unlocked).length);

    // ── 视图切换 ──────────────────────────────────────────────────────────────
    function enterApp() { view.value = 'app'; }
    function goHome() { L.stopAll(); view.value = 'home'; }
    function enterVocab() { L.stopAll(); view.value = 'vocab'; V.enterVocabTrainer(); }

    // ── 快捷键 ────────────────────────────────────────────────────────────────
    function onKeyDown(e) {
      if (popup.visible) { if (e.key === 'Escape') closePopup(); return; }
      if (e.key === 'Escape') {
        if (vocabOpen.value) { vocabOpen.value = false; return; }
        if (L.dictation.active) { L.closeDictation(); return; }
        if (L.shadow.active) { L.closeShadow(); return; }
        if (srsActive.value) { closeSRS(); return; }
      }
      if (srsActive.value || vocabOpen.value || statsModalOpen.value || L.importer.open) return;
      if (view.value === 'vocab') { V.vtOnKey(e); return; }
      if (view.value === 'app') L.onKey(e);
    }

    onMounted(() => {
      window.addEventListener('keydown', onKeyDown);
      L.loadCatalog();
      sidebarOpen.value = window.innerWidth >= 1024;
    });
    onUnmounted(() => window.removeEventListener('keydown', onKeyDown));

    const exposed = {
      view, sidebarOpen, enterApp, goHome, enterVocab, formatTime, tokenize, cleanWord,
      theme, setTheme, progressStats, achievements, achievementUnlockedCount, statsModalOpen,
      toastState, toast,
      // 生词本 / 查词 / SRS
      vocabOpen, vocabulary, vocabList, vocabCount, removeFromVocab, isWordSaved, playVocabAudio, vocabThumb, getEpTitle,
      popup, popupImg, openWordPopup, closePopup, playPopupAudio, addToVocab, playContext, atlasMeta,
      srsActive, srsCurrent, srsShowAnswer, srsQueue, dueReviewCount, startSRS, rateSRS, closeSRS,
      exportVocabAnki, exportVocabCSV, hardOpen,
      // 模块（模板里通过 reactive 包装自动解包嵌套 ref）
      L: reactive(L), ...V,
    };
    window.__LH__ = reactive(exposed); // 调试 / 端到端测试用
    return exposed;
  },
}).mount('#app');
