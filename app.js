const { createApp, ref, reactive, computed, watch, onMounted, onUnmounted, nextTick } = Vue;

// ── Data & Storage ────────────────────────────────────────────────────────────
const EPISODES = ALL_EPISODES;
const VOCAB_KEY    = 'voa_vocabulary';
const THEME_KEY    = 'voa_theme';
const PROGRESS_KEY = 'voa_progress';
const AUDIO_KEY    = 'voa_audio_map';   // { epId -> dataUrl } (blob URLs 临时存储时用)

function loadVocab() {
  try { return JSON.parse(localStorage.getItem(VOCAB_KEY) || '{}'); }
  catch { return {}; }
}
function saveVocab(v) {
  localStorage.setItem(VOCAB_KEY, JSON.stringify(v));
  if (typeof SyncManager !== 'undefined') SyncManager.schedulePush();
}

function loadTheme() {
  return localStorage.getItem(THEME_KEY) || 'light';
}
function saveTheme(t) {
  localStorage.setItem(THEME_KEY, t);
}

function loadProgress() {
  try {
    const raw = JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}');
    return {
      sentencesPlayed: raw.sentencesPlayed || 0,
      episodesStarted: raw.episodesStarted || {},  // { epId: ts }
      episodesCompleted: raw.episodesCompleted || {}, // { epId: ts }
      studyDays: raw.studyDays || {},              // { 'YYYY-MM-DD': count }
      lastStudyDate: raw.lastStudyDate || '',
      streak: raw.streak || 0
    };
  } catch {
    return { sentencesPlayed: 0, episodesStarted: {}, episodesCompleted: {}, studyDays: {}, lastStudyDate: '', streak: 0 };
  }
}
function saveProgress(p) {
  localStorage.setItem(PROGRESS_KEY, JSON.stringify(p));
  if (typeof SyncManager !== 'undefined') SyncManager.schedulePush();
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function yesterdayStr() {
  const d = new Date(); d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function formatTime(sec) {
  if (isNaN(sec) || !isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function cleanWord(w) {
  return w.replace(/[^a-zA-Z'-]/g, '').toLowerCase();
}

function tokenize(text) {
  const parts = text.split(/(\s+)/);
  return parts.map(p => ({
    raw: p,
    isWord: /[a-zA-Z]/.test(p),
    clean: cleanWord(p)
  }));
}

// ── Speech Synthesis (TTS) ────────────────────────────────────────────────────
// 使用浏览器内置 Web Speech API，免费无需音频文件
const synth = window.speechSynthesis;
let cachedVoice = null;

function getBestEnglishVoice() {
  if (cachedVoice) return cachedVoice;
  const voices = synth.getVoices();
  // 优先美式英语女声
  const preferred = [
    /en-US.*female/i, /Google US English/i, /Samantha/i, /Microsoft Zira/i,
    /en-US/i, /en-GB/i, /en/i
  ];
  for (const pat of preferred) {
    const v = voices.find(v => pat.test(v.name) || pat.test(v.lang));
    if (v) { cachedVoice = v; return v; }
  }
  return voices[0] || null;
}

function speakText(text, { rate = 0.7, onEnd, onStart } = {}) {
  if (!synth) return null;
  synth.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  const voice = getBestEnglishVoice();
  if (voice) utter.voice = voice;
  utter.lang = 'en-US';
  utter.rate = rate;
  utter.pitch = 1.0;
  if (onEnd) utter.onend = onEnd;
  if (onStart) utter.onstart = onStart;
  synth.speak(utter);
  return utter;
}

// ── Translate API (MyMemory - free, no key) ───────────────────────────────────
const translateCache = new Map();

async function translateToChinese(text) {
  if (translateCache.has(text)) return translateCache.get(text);
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|zh-CN`;
    const res = await fetch(url);
    const data = await res.json();
    const zh = data?.responseData?.translatedText || '';
    translateCache.set(text, zh);
    return zh;
  } catch {
    return '';
  }
}

// ── Dictionary API ────────────────────────────────────────────────────────────
async function fetchWordInfo(word) {
  const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
  if (!res.ok) throw new Error('Not found');
  const data = await res.json();
  const entry = data[0];

  let phonetic = '';
  let audioUrl = '';
  for (const p of (entry.phonetics || [])) {
    if (p.text && !phonetic) phonetic = p.text;
    if (p.audio && !audioUrl) audioUrl = p.audio;
  }

  const meanings = (entry.meanings || []).slice(0, 3).map(m => ({
    partOfSpeech: m.partOfSpeech,
    definition: m.definitions?.[0]?.definition || '',
    example: m.definitions?.[0]?.example || ''
  }));

  return { word: entry.word || word, phonetic, audioUrl, meanings };
}

// ── Vue App ───────────────────────────────────────────────────────────────────
createApp({
  setup() {
    const episodes = ref(EPISODES);
    const currentEp = ref(null);
    const showZh = ref(true);
    const searchQuery = ref('');
    const selectedCategory = ref('all');

    // ── Auth & Sync ───────────────────────────────────────────────────────────
    const authModalOpen = ref(false);
    const authStep = ref('email');  // 'email' | 'verify'
    const authEmail = ref('');
    const authCode = ref('');
    const authDisplayCode = ref('');
    const authError = ref('');
    const authLoading = ref(false);
    const authUser = ref(SyncManager.getUser());
    const syncVersion = ref(parseInt(localStorage.getItem('sync_version') || '0', 10));

    // ── Vocabulary (声明需在 SyncManager.onChange 之前) ──────────────────────
    const vocabOpen = ref(false);
    const vocabulary = ref(loadVocab());
    const vocabList = computed(() => Object.values(vocabulary.value).sort((a, b) => b.addedAt - a.addedAt));
    const vocabCount = computed(() => vocabList.value.length);

    // 初始化同步管理器
    SyncManager.init();
    SyncManager.onChange((event, data) => {
      if (event === 'login') {
        authUser.value = data;
      } else if (event === 'logout') {
        authUser.value = null;
        syncVersion.value = 0;
      } else if (event === 'synced') {
        syncVersion.value = data.version;
      } else if (event === 'dataUpdated') {
        // 云端数据合并后，刷新本地状态
        progress.value = loadProgress();
        vocabulary.value = loadVocab();
      }
    });

    async function doLogin() {
      if (!authEmail.value || !authEmail.value.includes('@')) {
        authError.value = '请输入有效的邮箱地址';
        return;
      }
      authError.value = '';
      authLoading.value = true;
      try {
        const result = await SyncManager.login(authEmail.value);
        authDisplayCode.value = result.code;
        authStep.value = 'verify';
      } catch (err) {
        authError.value = err.message;
      } finally {
        authLoading.value = false;
      }
    }

    async function doVerify() {
      if (!authCode.value || authCode.value.length !== 6) {
        authError.value = '请输入 6 位验证码';
        return;
      }
      authError.value = '';
      authLoading.value = true;
      try {
        await SyncManager.verify(authEmail.value, authCode.value);
        authModalOpen.value = false;
        // 重置登录表单
        authStep.value = 'email';
        authEmail.value = '';
        authCode.value = '';
        authDisplayCode.value = '';
      } catch (err) {
        authError.value = err.message;
      } finally {
        authLoading.value = false;
      }
    }

    function doLogout() {
      SyncManager.logout();
      authModalOpen.value = false;
      authStep.value = 'email';
    }

    // ── Theme ─────────────────────────────────────────────────────────────────
    const theme = ref(loadTheme());
    function setTheme(t) {
      theme.value = t;
      document.documentElement.setAttribute('data-theme', t);
      saveTheme(t);
    }
    // 初始应用
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', theme.value);
    }

    // ── Progress ──────────────────────────────────────────────────────────────
    const progress = ref(loadProgress());

    function recordSentencePlayed(epId) {
      // 只有登录后才记录打卡数据
      if (!SyncManager.isLoggedIn()) return;

      const p = progress.value;
      p.sentencesPlayed += 1;

      // 进入集
      if (!p.episodesStarted[epId]) p.episodesStarted[epId] = Date.now();

      // 今日学习天数 + streak
      const today = todayStr();
      if (!p.studyDays[today]) p.studyDays[today] = 0;
      p.studyDays[today] += 1;

      if (p.lastStudyDate !== today) {
        p.streak = p.lastStudyDate === yesterdayStr() ? (p.streak || 0) + 1 : 1;
        p.lastStudyDate = today;
      }

      saveProgress(p);
    }

    function recordEpisodeCompleted(epId) {
      // 只有登录后才记录完成数据
      if (!SyncManager.isLoggedIn()) return;

      const p = progress.value;
      p.episodesCompleted[epId] = Date.now();
      saveProgress(p);
    }

    const progressStats = computed(() => {
      const p = progress.value;
      return {
        sentencesPlayed: p.sentencesPlayed,
        episodesStartedCount: Object.keys(p.episodesStarted).length,
        episodesCompletedCount: Object.keys(p.episodesCompleted).length,
        streak: p.streak,
        todayCount: p.studyDays[todayStr()] || 0,
        totalDays: Object.keys(p.studyDays || {}).length
      };
    });

    // ── 勋章成就系统 ──────────────────────────────────────────────────────────
    const ACHIEVEMENTS = [
      // 连续打卡
      { id: 'streak_3',   icon: '\u{1F331}', name: '初学者',     desc: '连续学习 3 天',     category: '打卡', check: (p, v) => p.streak >= 3 },
      { id: 'streak_7',   icon: '\u{1F525}', name: '坚持一周',   desc: '连续学习 7 天',     category: '打卡', check: (p, v) => p.streak >= 7 },
      { id: 'streak_30',  icon: '\u{2B50}',  name: '月度达人',   desc: '连续学习 30 天',    category: '打卡', check: (p, v) => p.streak >= 30 },
      { id: 'streak_100', icon: '\u{1F48E}', name: '百日坚持',   desc: '连续学习 100 天',   category: '打卡', check: (p, v) => p.streak >= 100 },
      // 累计天数
      { id: 'days_10',    icon: '\u{1F4C5}', name: '学习10天',   desc: '累计学习 10 天',    category: '累计', check: (p, v) => p.totalDays >= 10 },
      { id: 'days_30',    icon: '\u{1F4C6}', name: '学习30天',   desc: '累计学习 30 天',    category: '累计', check: (p, v) => p.totalDays >= 30 },
      // 听力句数
      { id: 'sent_1',     icon: '\u{1F442}', name: '初次听力',   desc: '听完第 1 句',       category: '听力', check: (p, v) => p.sentencesPlayed >= 1 },
      { id: 'sent_100',   icon: '\u{1F3A7}', name: '百句达成',   desc: '累计听 100 句',     category: '听力', check: (p, v) => p.sentencesPlayed >= 100 },
      { id: 'sent_1000',  icon: '\u{1F3B5}', name: '千句大师',   desc: '累计听 1000 句',    category: '听力', check: (p, v) => p.sentencesPlayed >= 1000 },
      // 完成篇数
      { id: 'ep_1',       icon: '\u{1F463}', name: '第一步',     desc: '完成 1 篇听力',     category: '完成', check: (p, v) => p.episodesCompletedCount >= 1 },
      { id: 'ep_20',      icon: '\u{1F680}', name: '进阶学者',   desc: '完成 20 篇听力',    category: '完成', check: (p, v) => p.episodesCompletedCount >= 20 },
      { id: 'ep_100',     icon: '\u{1F451}', name: '满分通关',   desc: '完成全部 100 篇',   category: '完成', check: (p, v) => p.episodesCompletedCount >= 100 },
      // 词汇量
      { id: 'vocab_10',   icon: '\u{1F4DD}', name: '收词新手',   desc: '收藏 10 个生词',    category: '词汇', check: (p, v) => v >= 10 },
      { id: 'vocab_50',   icon: '\u{1F4DA}', name: '词汇达人',   desc: '收藏 50 个生词',    category: '词汇', check: (p, v) => v >= 50 },
      { id: 'vocab_200',  icon: '\u{1F3C6}', name: '词汇大师',   desc: '收藏 200 个生词',   category: '词汇', check: (p, v) => v >= 200 },
    ];

    const achievements = computed(() => {
      const p = progressStats.value;
      const v = vocabCount.value;
      return ACHIEVEMENTS.map(a => ({
        ...a,
        unlocked: a.check(p, v)
      }));
    });

    const achievementUnlockedCount = computed(() => achievements.value.filter(a => a.unlocked).length);


    // 分类列表
    const categories = computed(() => {
      const cats = [...new Set(EPISODES.map(e => e.category))];
      return ['all', ...cats];
    });

    // 分类颜色映射
    const categoryColors = {
      'all':         { dot: 'bg-gray-400',    bg: 'bg-gray-50',    border: 'border-gray-200',    text: 'text-gray-700',    hoverBg: 'hover:bg-gray-100',  activeBg: 'from-gray-500 to-gray-600' },
      'Health':      { dot: 'bg-rose-400',    bg: 'bg-rose-50',    border: 'border-rose-200',    text: 'text-rose-700',    hoverBg: 'hover:bg-rose-100',  activeBg: 'from-rose-500 to-pink-500' },
      'Science':     { dot: 'bg-blue-400',    bg: 'bg-blue-50',    border: 'border-blue-200',    text: 'text-blue-700',    hoverBg: 'hover:bg-blue-100',  activeBg: 'from-blue-500 to-blue-600' },
      'Technology':  { dot: 'bg-cyan-400',    bg: 'bg-cyan-50',    border: 'border-cyan-200',    text: 'text-cyan-700',    hoverBg: 'hover:bg-cyan-100',  activeBg: 'from-cyan-500 to-teal-500' },
      'Nature':      { dot: 'bg-green-400',   bg: 'bg-green-50',   border: 'border-green-200',   text: 'text-green-700',   hoverBg: 'hover:bg-green-100', activeBg: 'from-green-500 to-emerald-500' },
      'Culture':     { dot: 'bg-purple-400',  bg: 'bg-purple-50',  border: 'border-purple-200',  text: 'text-purple-700',  hoverBg: 'hover:bg-purple-100', activeBg: 'from-purple-500 to-violet-500' },
      'History':     { dot: 'bg-amber-400',   bg: 'bg-amber-50',   border: 'border-amber-200',   text: 'text-amber-700',   hoverBg: 'hover:bg-amber-100', activeBg: 'from-amber-500 to-orange-500' },
      'Food':        { dot: 'bg-orange-400',  bg: 'bg-orange-50',  border: 'border-orange-200',  text: 'text-orange-700',  hoverBg: 'hover:bg-orange-100', activeBg: 'from-orange-500 to-red-400' },
      'Space':       { dot: 'bg-indigo-400',  bg: 'bg-indigo-50',  border: 'border-indigo-200',  text: 'text-indigo-700',  hoverBg: 'hover:bg-indigo-100', activeBg: 'from-indigo-500 to-purple-500' },
      'Business':    { dot: 'bg-slate-400',   bg: 'bg-slate-50',   border: 'border-slate-200',   text: 'text-slate-700',   hoverBg: 'hover:bg-slate-100', activeBg: 'from-slate-500 to-gray-600' },
      'Education':   { dot: 'bg-teal-400',    bg: 'bg-teal-50',    border: 'border-teal-200',    text: 'text-teal-700',    hoverBg: 'hover:bg-teal-100',  activeBg: 'from-teal-500 to-cyan-500' },
      'Travel':      { dot: 'bg-sky-400',     bg: 'bg-sky-50',     border: 'border-sky-200',     text: 'text-sky-700',     hoverBg: 'hover:bg-sky-100',   activeBg: 'from-sky-500 to-blue-500' },
      'Music':       { dot: 'bg-pink-400',    bg: 'bg-pink-50',    border: 'border-pink-200',    text: 'text-pink-700',    hoverBg: 'hover:bg-pink-100',  activeBg: 'from-pink-500 to-rose-500' },
      'Sports':      { dot: 'bg-red-400',     bg: 'bg-red-50',     border: 'border-red-200',     text: 'text-red-700',     hoverBg: 'hover:bg-red-100',   activeBg: 'from-red-500 to-rose-600' },
      'Psychology':  { dot: 'bg-violet-400',  bg: 'bg-violet-50',  border: 'border-violet-200',  text: 'text-violet-700',  hoverBg: 'hover:bg-violet-100', activeBg: 'from-violet-500 to-purple-500' },
      'Environment': { dot: 'bg-emerald-400', bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', hoverBg: 'hover:bg-emerald-100', activeBg: 'from-emerald-500 to-green-500' },
      'Biography':   { dot: 'bg-fuchsia-400', bg: 'bg-fuchsia-50', border: 'border-fuchsia-200', text: 'text-fuchsia-700', hoverBg: 'hover:bg-fuchsia-100', activeBg: 'from-fuchsia-500 to-pink-500' },
      'Art':         { dot: 'bg-yellow-400',  bg: 'bg-yellow-50',  border: 'border-yellow-200',  text: 'text-yellow-700',  hoverBg: 'hover:bg-yellow-100', activeBg: 'from-yellow-500 to-amber-500' },
      'Economy':     { dot: 'bg-lime-500',    bg: 'bg-lime-50',    border: 'border-lime-200',    text: 'text-lime-700',    hoverBg: 'hover:bg-lime-100',  activeBg: 'from-lime-500 to-green-500' },
      'Cinema':      { dot: 'bg-red-300',     bg: 'bg-red-50',     border: 'border-red-200',     text: 'text-red-600',     hoverBg: 'hover:bg-red-100',   activeBg: 'from-red-400 to-orange-500' },
      'Idioms':      { dot: 'bg-teal-300',    bg: 'bg-teal-50',    border: 'border-teal-200',    text: 'text-teal-600',    hoverBg: 'hover:bg-teal-100',  activeBg: 'from-teal-400 to-emerald-500' }
    };

    function getCatColor(cat) {
      return categoryColors[cat] || categoryColors['all'];
    }

    // 筛选后的节目列表
    const filteredEpisodes = computed(() => {
      let list = EPISODES;
      if (selectedCategory.value !== 'all') {
        list = list.filter(e => e.category === selectedCategory.value);
      }
      const q = searchQuery.value.trim().toLowerCase();
      if (q) {
        list = list.filter(e =>
          e.title.toLowerCase().includes(q) ||
          e.description.toLowerCase().includes(q) ||
          e.category.toLowerCase().includes(q)
        );
      }
      return list;
    });

    const isPlaying = ref(false);
    const activeSentenceId = ref(null);
    const loopSentence = ref(false);
    const speechRate = ref(0.7);    // 默认 VOA 慢速（约 90 wpm）
    const playMode = ref('single');   // 'single' | 'sequence' —— 区分单句/整集
    const view = ref('home');         // 'home' | 'app' —— 首页 vs 主界面

    const popup = reactive({
      visible: false,
      loading: false,
      error: false,
      word: '',
      data: null,
      translation: '',          // 新增：中文翻译
      translationLoading: false,
      fromSentenceId: null
    });

    // ── MP3 audio map (per-episode uploaded audio) ────────────────────────────
    // 由于 localStorage 不适合存大文件，采用内存 + IndexedDB 混合；这里用简单的内存 Map
    const audioMap = reactive({});  // { epId: blobUrl }
    const audioEl = ref(null);      // 真实 <audio> 元素引用
    const useRealAudio = computed(() => !!audioMap[currentEp.value?.id]);
    const audioCurrentTime = ref(0);
    const audioDuration = ref(0);

    function uploadAudio(epId, file) {
      if (!file) return;
      const url = URL.createObjectURL(file);
      audioMap[epId] = url;
      // 下次加载 audio 元素
      nextTick(() => {
        if (audioEl.value) {
          audioEl.value.src = url;
          audioEl.value.load();
        }
      });
    }
    function removeAudio(epId) {
      if (audioMap[epId]) {
        URL.revokeObjectURL(audioMap[epId]);
        delete audioMap[epId];
        if (audioEl.value) { audioEl.value.src = ''; }
      }
    }

    // ── Dictation 听写模式 ────────────────────────────────────────────────────
    const dictation = reactive({
      active: false,
      sentenceId: null,
      userInput: '',
      result: null,   // { correct, total, score, diff: [] }
    });

    function startDictation(sentence) {
      stopSpeaking();
      dictation.active = true;
      dictation.sentenceId = sentence.id;
      dictation.userInput = '';
      dictation.result = null;
      // 朗读句子供用户听写
      speakText(sentence.en, { rate: speechRate.value * 0.95 });
    }

    function replayDictation() {
      const sent = currentEp.value?.sentences.find(s => s.id === dictation.sentenceId);
      if (sent) speakText(sent.en, { rate: speechRate.value * 0.95 });
    }

    function submitDictation() {
      const sent = currentEp.value?.sentences.find(s => s.id === dictation.sentenceId);
      if (!sent) return;
      const answer = sent.en;
      const userWords = dictation.userInput.trim().toLowerCase().replace(/[.,!?;:"'()]/g, '').split(/\s+/).filter(Boolean);
      const correctWords = answer.toLowerCase().replace(/[.,!?;:"'()]/g, '').split(/\s+/).filter(Boolean);

      // 简单逐词对比
      const maxLen = Math.max(userWords.length, correctWords.length);
      let correct = 0;
      const diff = [];
      for (let i = 0; i < maxLen; i++) {
        const u = userWords[i] || '';
        const c = correctWords[i] || '';
        const isCorrect = u === c;
        if (isCorrect) correct += 1;
        diff.push({ user: u, correct: c, ok: isCorrect });
      }
      dictation.result = {
        correct,
        total: correctWords.length,
        score: Math.round((correct / correctWords.length) * 100),
        diff
      };
    }

    function closeDictation() {
      dictation.active = false;
      dictation.sentenceId = null;
      dictation.userInput = '';
      dictation.result = null;
    }

    // ── Shadowing 跟读模式 ────────────────────────────────────────────────────
    const shadow = reactive({
      active: false,
      sentenceId: null,
      recording: false,
      recordedUrl: null,
      error: ''
    });
    let mediaRecorder = null;
    let recordedChunks = [];

    function openShadowing(sentence) {
      stopSpeaking();
      shadow.active = true;
      shadow.sentenceId = sentence.id;
      shadow.recording = false;
      shadow.error = '';
      if (shadow.recordedUrl) { URL.revokeObjectURL(shadow.recordedUrl); shadow.recordedUrl = null; }
    }

    function playShadowOriginal() {
      const sent = currentEp.value?.sentences.find(s => s.id === shadow.sentenceId);
      if (sent) speakText(sent.en, { rate: speechRate.value });
    }

    async function startRecording() {
      if (shadow.recording) return;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        recordedChunks = [];
        mediaRecorder = new MediaRecorder(stream);
        mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recordedChunks.push(e.data); };
        mediaRecorder.onstop = () => {
          const blob = new Blob(recordedChunks, { type: 'audio/webm' });
          if (shadow.recordedUrl) URL.revokeObjectURL(shadow.recordedUrl);
          shadow.recordedUrl = URL.createObjectURL(blob);
          // 停止所有 tracks
          stream.getTracks().forEach(t => t.stop());
        };
        mediaRecorder.start();
        shadow.recording = true;
        shadow.error = '';
      } catch (err) {
        shadow.error = '无法访问麦克风，请检查浏览器权限';
      }
    }

    function stopRecording() {
      if (mediaRecorder && shadow.recording) {
        mediaRecorder.stop();
        shadow.recording = false;
      }
    }

    function playRecording() {
      if (shadow.recordedUrl) new Audio(shadow.recordedUrl).play().catch(() => {});
    }

    function closeShadowing() {
      if (shadow.recording) stopRecording();
      if (shadow.recordedUrl) { URL.revokeObjectURL(shadow.recordedUrl); shadow.recordedUrl = null; }
      shadow.active = false;
      shadow.sentenceId = null;
    }

    // ── SRS 生词本间隔复习 ────────────────────────────────────────────────────
    const srsActive = ref(false);
    const srsCurrent = ref(null);      // 当前复习的单词对象
    const srsShowAnswer = ref(false);
    const srsQueue = ref([]);          // 待复习队列

    // 初始化新词的 SRS 字段
    function initSRS(item) {
      if (typeof item.srsLevel === 'undefined') {
        item.srsLevel = 0;       // 0 ~ 5
        item.srsEase = 2.5;      // 难度因子
        item.nextReviewAt = Date.now();
        item.lastReviewAt = 0;
      }
      return item;
    }

    // 筛选到期复习的单词
    const dueReviewCount = computed(() => {
      const now = Date.now();
      return vocabList.value.filter(v => !v.nextReviewAt || v.nextReviewAt <= now).length;
    });

    function startSRS() {
      const now = Date.now();
      const due = vocabList.value.filter(v => !v.nextReviewAt || v.nextReviewAt <= now);
      if (due.length === 0) return;
      srsQueue.value = [...due].sort(() => Math.random() - 0.5); // 随机打乱
      srsActive.value = true;
      srsCurrent.value = srsQueue.value[0];
      srsShowAnswer.value = false;
    }

    // SM-2 简化：quality = 0(忘)/1(难)/2(好)/3(熟)
    function rateSRS(quality) {
      if (!srsCurrent.value) return;
      const word = srsCurrent.value.word.toLowerCase();
      const item = vocabulary.value[word];
      if (!item) return;
      initSRS(item);

      // 间隔计算（单位：毫秒）
      const DAY = 24 * 60 * 60 * 1000;
      const baseIntervals = [1, 6, 1 * DAY, 3 * DAY, 7 * DAY, 21 * DAY, 60 * DAY];

      if (quality === 0) {
        item.srsLevel = 0;
        item.srsEase = Math.max(1.3, item.srsEase - 0.2);
      } else {
        item.srsLevel = Math.min(6, item.srsLevel + (quality === 1 ? 0 : 1));
        item.srsEase = Math.max(1.3, item.srsEase + (quality - 1) * 0.1);
      }
      const idx = Math.min(item.srsLevel, baseIntervals.length - 1);
      item.nextReviewAt = Date.now() + baseIntervals[idx] * item.srsEase;
      item.lastReviewAt = Date.now();

      saveVocab(vocabulary.value);

      // 下一个
      srsQueue.value.shift();
      if (srsQueue.value.length === 0) {
        srsActive.value = false;
        srsCurrent.value = null;
      } else {
        srsCurrent.value = srsQueue.value[0];
        srsShowAnswer.value = false;
      }
    }

    function closeSRS() {
      srsActive.value = false;
      srsCurrent.value = null;
      srsQueue.value = [];
    }

    // ── Export Vocabulary ─────────────────────────────────────────────────────
    function triggerDownload(filename, content, mime = 'text/plain;charset=utf-8') {
      const blob = new Blob([content], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function exportVocabAnki() {
      // Anki txt 格式：front\tback，每行一个卡片
      const lines = vocabList.value.map(v => {
        const front = v.word;
        const parts = [];
        if (v.phonetic) parts.push(v.phonetic);
        if (v.translation) parts.push(v.translation);
        if (v.meanings && v.meanings.length) {
          parts.push(v.meanings.map(m => `[${m.partOfSpeech}] ${m.definition}`).join(' · '));
        }
        const back = parts.join(' | ').replace(/\t/g, ' ');
        return `${front}\t${back}`;
      });
      triggerDownload(`vocabulary-${todayStr()}.txt`, lines.join('\n'));
    }

    function exportVocabCSV() {
      const header = 'Word,Phonetic,Translation,Meanings,From Episode,Added At';
      const rows = vocabList.value.map(v => {
        const meanings = (v.meanings || []).map(m => `[${m.partOfSpeech}] ${m.definition}`).join(' | ');
        const cells = [
          v.word, v.phonetic || '', v.translation || '', meanings,
          v.fromEpisode || '', new Date(v.addedAt || Date.now()).toISOString()
        ].map(c => `"${String(c).replace(/"/g, '""')}"`);
        return cells.join(',');
      });
      triggerDownload(`vocabulary-${todayStr()}.csv`, '\ufeff' + header + '\n' + rows.join('\n'), 'text/csv;charset=utf-8');
    }

    const activeSentence = computed(() =>
      currentEp.value?.sentences.find(s => s.id === activeSentenceId.value) || null
    );

    // ── Episode selection ─────────────────────────────────────────────────────
    function selectEpisode(ep) {
      if (currentEp.value?.id === ep.id) return;
      stopSpeaking();
      currentEp.value = ep;
      activeSentenceId.value = null;
      isPlaying.value = false;
    }

    // ── Playback (TTS) ────────────────────────────────────────────────────────
    // 单句播放（始终 TTS，便于逐句精听）
    function playSentence(sentence) {
      if (!sentence) return;
      stopSpeaking();
      stopAudioPlayer();
      playMode.value = 'single';
      activeSentenceId.value = sentence.id;

      speakText(sentence.en, {
        rate: speechRate.value,
        onStart: () => {
          isPlaying.value = true;
          recordSentencePlayed(currentEp.value?.id);
        },
        onEnd: () => {
          isPlaying.value = false;
          // 单句模式下开启循环就重播
          if (loopSentence.value && activeSentenceId.value === sentence.id && playMode.value === 'single') {
            setTimeout(() => playSentence(sentence), 400);
          }
        }
      });
    }

    // 整集顺序播放（从指定句子起，或默认从头开始）
    function playEpisode(startFromId = null) {
      if (!currentEp.value) return;
      stopSpeaking();
      playMode.value = 'sequence';
      const sents = currentEp.value.sentences;
      const startIdx = startFromId
        ? Math.max(0, sents.findIndex(s => s.id === startFromId))
        : 0;
      playFromIndex(startIdx);
    }

    function playFromIndex(idx) {
      if (!currentEp.value || playMode.value !== 'sequence') return;
      const sents = currentEp.value.sentences;
      if (idx >= sents.length) {
        // 整集播放完毕
        isPlaying.value = false;
        playMode.value = 'single';
        return;
      }
      const sent = sents[idx];
      activeSentenceId.value = sent.id;

      speakText(sent.en, {
        rate: speechRate.value,
        onStart: () => {
          isPlaying.value = true;
          recordSentencePlayed(currentEp.value?.id);
        },
        onEnd: () => {
          // 循环开关优先：无论单句模式还是整集模式，开启循环就重播当前句
          if (loopSentence.value && activeSentenceId.value === sent.id) {
            setTimeout(() => playFromIndex(idx), 400);
            return;
          }
          // 未循环：整集模式继续下一句，单句模式停止
          if (playMode.value === 'sequence' && activeSentenceId.value === sent.id) {
            if (idx + 1 >= currentEp.value.sentences.length) {
              // 最后一句结束 → 标记整集已完成
              recordEpisodeCompleted(currentEp.value.id);
            }
            setTimeout(() => playFromIndex(idx + 1), 350);
          } else {
            isPlaying.value = false;
          }
        }
      });
    }

    function stopSpeaking() {
      if (synth) synth.cancel();
      isPlaying.value = false;
    }

    function stopAudioPlayer() {
      if (audioEl.value) {
        audioEl.value.pause();
      }
    }

    function pauseAudio() {
      stopSpeaking();
      stopAudioPlayer();
      // 保持 playMode 便于"继续"时恢复
    }

    // 整集 MP3 播放（整段从头播放到底）
    function playEpisodeAudio() {
      if (!audioEl.value || !useRealAudio.value) return;
      playMode.value = 'sequence';
      audioEl.value.currentTime = 0;
      audioEl.value.play().then(() => {
        isPlaying.value = true;
        recordSentencePlayed(currentEp.value?.id);
      }).catch(() => { isPlaying.value = false; });
    }

    function onAudioTimeUpdate() {
      if (audioEl.value) audioCurrentTime.value = audioEl.value.currentTime;
    }
    function onAudioLoaded() {
      if (audioEl.value) audioDuration.value = audioEl.value.duration;
    }
    function onAudioEnded() {
      isPlaying.value = false;
      recordEpisodeCompleted(currentEp.value?.id);
    }
    function seekAudio(e) {
      if (!audioEl.value || !audioDuration.value) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const ratio = (e.clientX - rect.left) / rect.width;
      audioEl.value.currentTime = ratio * audioDuration.value;
    }

    function resumePlay() {
      // 根据 playMode 恢复播放
      if (!activeSentence.value) {
        playEpisode();
        return;
      }
      if (playMode.value === 'sequence') {
        const idx = currentEp.value.sentences.findIndex(s => s.id === activeSentenceId.value);
        playFromIndex(idx >= 0 ? idx : 0);
      } else {
        playSentence(activeSentence.value);
      }
    }

    function prevSentence() {
      if (!currentEp.value) return;
      const sents = currentEp.value.sentences;
      const idx = sents.findIndex(s => s.id === activeSentenceId.value);
      const target = idx > 0 ? sents[idx - 1] : (idx === -1 && sents.length ? sents[0] : null);
      if (!target) return;
      if (playMode.value === 'sequence') {
        playFromIndex(sents.indexOf(target));
      } else {
        playSentence(target);
      }
    }

    function nextSentence() {
      if (!currentEp.value) return;
      const sents = currentEp.value.sentences;
      const idx = sents.findIndex(s => s.id === activeSentenceId.value);
      if (idx < sents.length - 1) {
        if (playMode.value === 'sequence') {
          playFromIndex(idx + 1);
        } else {
          playSentence(sents[idx + 1]);
        }
      }
    }

    function replaySentence() {
      if (activeSentence.value) playSentence(activeSentence.value);
    }

    function setRate(r) {
      speechRate.value = r;
      if (isPlaying.value && activeSentence.value) {
        if (playMode.value === 'sequence') {
          const idx = currentEp.value.sentences.findIndex(s => s.id === activeSentenceId.value);
          playFromIndex(idx);
        } else {
          playSentence(activeSentence.value);
        }
      }
    }

    // 首页 → 主界面
    function enterApp() { view.value = 'app'; }
    function goHome() {
      stopSpeaking();
      view.value = 'home';
    }

    // ── Word popup ────────────────────────────────────────────────────────────
    async function openWordPopup(rawWord, sentenceId) {
      const word = cleanWord(rawWord);
      if (!word || word.length < 2) return;

      popup.visible = true;
      popup.loading = true;
      popup.error = false;
      popup.data = null;
      popup.translation = '';
      popup.translationLoading = true;
      popup.word = word;
      popup.fromSentenceId = sentenceId;

      // 并行请求词典 + 翻译
      const [dictRes, trRes] = await Promise.allSettled([
        fetchWordInfo(word),
        translateToChinese(word)
      ]);

      popup.loading = false;
      popup.translationLoading = false;

      if (dictRes.status === 'fulfilled') {
        popup.data = dictRes.value;
      } else {
        popup.error = true;
      }

      if (trRes.status === 'fulfilled') {
        popup.translation = trRes.value;
      }
    }

    function closePopup() {
      popup.visible = false;
    }

    function playPopupAudio() {
      if (popup.data?.audioUrl) {
        new Audio(popup.data.audioUrl).play().catch(() => {
          // Fallback to TTS if audio fails
          speakText(popup.word, { rate: 0.9 });
        });
      } else {
        speakText(popup.word, { rate: 0.9 });
      }
    }

    // ── Vocabulary ────────────────────────────────────────────────────────────
    function addToVocab() {
      if (!popup.data && !popup.word) return;
      const key = (popup.data?.word || popup.word).toLowerCase();
      vocabulary.value[key] = {
        word: popup.data?.word || popup.word,
        phonetic: popup.data?.phonetic || '',
        audioUrl: popup.data?.audioUrl || '',
        meanings: popup.data?.meanings || [],
        translation: popup.translation || '',       // 新增：中文翻译
        addedAt: Date.now(),
        fromEpisode: currentEp.value?.id || '',
        fromSentenceId: popup.fromSentenceId
      };
      saveVocab(vocabulary.value);
      popup.visible = false;
    }

    function removeFromVocab(word) {
      const key = word.toLowerCase();
      delete vocabulary.value[key];
      vocabulary.value = { ...vocabulary.value };
      saveVocab(vocabulary.value);
    }

    function isWordSaved(word) {
      return !!vocabulary.value[cleanWord(word)?.toLowerCase()];
    }

    function playVocabAudio(item) {
      if (item.audioUrl) {
        new Audio(item.audioUrl).play().catch(() => speakText(item.word, { rate: 0.9 }));
      } else {
        speakText(item.word, { rate: 0.9 });
      }
    }

    function getEpTitle(epId) {
      return EPISODES.find(e => e.id === epId)?.title || epId;
    }

    // ── Keyboard shortcuts ────────────────────────────────────────────────────
    function onKeyDown(e) {
      if (popup.visible) {
        if (e.key === 'Escape') closePopup();
        return;
      }
      if (vocabOpen.value && e.key === 'Escape') { vocabOpen.value = false; return; }
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'ArrowLeft')  { e.preventDefault(); prevSentence(); }
      if (e.key === 'ArrowRight') { e.preventDefault(); nextSentence(); }
      if (e.key === ' ') {
        e.preventDefault();
        if (activeSentence.value) {
          isPlaying.value ? pauseAudio() : replaySentence();
        } else if (currentEp.value) {
          playSentence(currentEp.value.sentences[0]);
        }
      }
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────
    onMounted(() => {
      window.addEventListener('keydown', onKeyDown);
      // 预加载语音列表（某些浏览器异步加载）
      if (synth) {
        synth.getVoices();
        synth.onvoiceschanged = () => { cachedVoice = null; getBestEnglishVoice(); };
      }
    });

    onUnmounted(() => {
      window.removeEventListener('keydown', onKeyDown);
      stopSpeaking();
    });

    return {
      episodes, currentEp, showZh, selectEpisode,
      searchQuery, selectedCategory, categories, filteredEpisodes, getCatColor,
      isPlaying, activeSentenceId, activeSentence,
      loopSentence, speechRate, setRate,
      playMode, view, enterApp, goHome,
      formatTime,
      playSentence, playEpisode, pauseAudio, resumePlay,
      prevSentence, nextSentence, replaySentence,
      popup, openWordPopup, closePopup, playPopupAudio,
      vocabOpen, vocabulary, vocabList, vocabCount,
      addToVocab, removeFromVocab, isWordSaved, playVocabAudio,
      getEpTitle, tokenize, cleanWord,
      // Theme & progress
      theme, setTheme, progressStats,
      // Achievements
      achievements, achievementUnlockedCount,
      // Auth & Sync
      authModalOpen, authStep, authEmail, authCode, authDisplayCode, authError, authLoading,
      authUser, syncVersion, doLogin, doVerify, doLogout,
      // Dictation
      dictation, startDictation, replayDictation, submitDictation, closeDictation,
      // Shadowing
      shadow, openShadowing, playShadowOriginal, startRecording, stopRecording, playRecording, closeShadowing,
      // SRS
      srsActive, srsCurrent, srsShowAnswer, dueReviewCount, startSRS, rateSRS, closeSRS,
      // Export
      exportVocabAnki, exportVocabCSV,
      // MP3 upload
      audioMap, audioEl, useRealAudio, audioCurrentTime, audioDuration,
      uploadAudio, removeAudio, playEpisodeAudio,
      onAudioTimeUpdate, onAudioLoaded, onAudioEnded, seekAudio
    };
  }
}).mount('#app');
