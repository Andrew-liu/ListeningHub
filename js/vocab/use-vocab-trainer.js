// 背单词模块：8 个词库（含 word-atlas 雅思·词光）、浏览 / 拼写 / 默写，与生词本 SRS 联动
import { fetchJSON } from '../lib/utils.js';
import { pronounce, loadAtlasMeta, mediaUrlSync, hasMedia, playUrl } from '../lib/atlas.js';

const { ref, reactive, computed } = Vue;

export const VT_LIBS = {
  ielts: '雅思·词光', chuzhong: '初中', gaozhong: '高中', cet4: 'CET4', cet6: 'CET6', kaoyan: '考研', toefl: '托福', sat: 'SAT',
};

export function useVocabTrainer(ctx) {
  const vt = reactive({
    manifest: null,
    library: VT_LIBS[localStorage.getItem('vt_library')] ? localStorage.getItem('vt_library') : 'ielts',
    index: 1,
    word: null,
    loading: false,
    error: false,
    showMeaning: localStorage.getItem('vt_show_meaning') !== 'false',
    jumpInput: '',
    searchInput: '',
    searchMsg: '',
    searchError: false,
    searching: false,
    accent: localStorage.getItem('vt_accent') || 'us',
    imgLarge: false,
  });
  const atlasMeta = ref(null);
  loadAtlasMeta().then(m => { atlasMeta.value = m; });

  const chunkCache = new Map();
  const indexCache = new Map();
  let reqId = 0;

  const total = computed(() => vt.manifest?.libs?.[vt.library]?.total || 0);
  const wordSaved = computed(() => !!(vt.word && ctx.vocabulary.value[vt.word.word.toLowerCase()]));
  const atlas = computed(() => vt.word?.atlas || null);
  const atlasTopic = computed(() => (atlas.value && atlasMeta.value ? atlasMeta.value.topics[atlas.value.topic] || atlas.value.topic : ''));

  function atlasMedia(kind) {
    const a = atlas.value;
    if (!a || !atlasMeta.value) return '';
    if (kind !== 'thumb' && !hasMedia(a.m, kind)) return '';
    if (kind === 'thumb' && !hasMedia(a.m, 'img')) return '';
    return mediaUrlSync(atlasMeta.value, a.id, kind);
  }

  async function ensureManifest() {
    if (!vt.manifest) vt.manifest = await fetchJSON('data/vocab/manifest.json');
  }

  async function fetchChunk(lib, idx) {
    const key = `${lib}/${idx}`;
    if (!chunkCache.has(key)) chunkCache.set(key, fetchJSON(`data/vocab/${lib}/${idx}.json`).catch(e => { chunkCache.delete(key); throw e; }));
    return chunkCache.get(key);
  }

  async function loadWord() {
    const id = ++reqId;
    vt.loading = true;
    vt.error = false;
    vt.imgLarge = false;
    try {
      await ensureManifest();
      const size = vt.manifest.chunkSize;
      const words = await fetchChunk(vt.library, Math.floor((vt.index - 1) / size));
      if (id !== reqId) return;
      vt.word = words[(vt.index - 1) % size] || null;
      spellReset();
      if (spell.active && spell.hideWord && vt.word) setTimeout(() => { if (id === reqId) speak(); }, 150);
      ctx.recordStudy();
    } catch {
      if (id === reqId) { vt.word = null; vt.error = true; }
    } finally {
      if (id === reqId) vt.loading = false;
    }
  }

  function go(idx) {
    const next = Math.min(Math.max(idx, 1), total.value || 1);
    vt.index = next;
    localStorage.setItem(`vt_index_${vt.library}`, String(next));
    loadWord();
  }
  const prev = () => { if (vt.index > 1) go(vt.index - 1); };
  const next = () => { if (vt.index < total.value) go(vt.index + 1); };
  function jump() {
    const n = parseInt(vt.jumpInput, 10);
    if (!Number.isNaN(n)) go(n);
    vt.jumpInput = '';
  }

  function setLibrary(lib) {
    if (!VT_LIBS[lib]) return;
    vt.library = lib;
    localStorage.setItem('vt_library', lib);
    vt.index = parseInt(localStorage.getItem(`vt_index_${lib}`) || '1', 10);
    vt.searchMsg = '';
    loadWord();
  }

  function toggleMeaning() {
    vt.showMeaning = !vt.showMeaning;
    localStorage.setItem('vt_show_meaning', String(vt.showMeaning));
  }

  function speak(accent) {
    if (!vt.word) return;
    const a = accent || vt.accent;
    if (accent) { vt.accent = accent; localStorage.setItem('vt_accent', accent); }
    pronounce(vt.word.word, a);
  }

  // 例句朗读（word-atlas 提供 ex / ex2）
  function playExample(i) {
    const url = atlasMedia(i === 0 ? 'ex' : 'ex2');
    if (url) playUrl(url).catch(() => {});
  }
  const exampleHasAudio = i => !!atlasMedia(i === 0 ? 'ex' : 'ex2');

  async function search() {
    const q = vt.searchInput.trim().toLowerCase();
    if (!q || vt.searching) return;
    vt.searching = true;
    vt.searchMsg = '';
    try {
      await ensureManifest();
      const libs = [vt.library, ...Object.keys(VT_LIBS).filter(k => k !== vt.library)];
      for (const lib of libs) {
        if (!vt.manifest.libs[lib]) continue;
        if (!indexCache.has(lib)) indexCache.set(lib, fetchJSON(`data/vocab/${lib}/index.json`));
        const pos = (await indexCache.get(lib)).indexOf(q);
        if (pos >= 0) {
          vt.library = lib;
          localStorage.setItem('vt_library', lib);
          vt.index = pos + 1;
          localStorage.setItem(`vt_index_${lib}`, String(pos + 1));
          await loadWord();
          vt.searchMsg = `已跳转到 ${q}（${VT_LIBS[lib]}词库）`;
          vt.searchError = false;
          return;
        }
      }
      vt.searchMsg = `未找到 "${q}"`;
      vt.searchError = true;
    } catch {
      vt.searchMsg = '搜索失败，请稍后重试';
      vt.searchError = true;
    } finally {
      vt.searching = false;
    }
  }

  function addToVocab() {
    const w = vt.word;
    if (!w) return;
    const a = w.atlas;
    ctx.addVocabItem({
      word: w.word,
      phonetic: w.us ? `/${w.us}/` : '',
      audioUrl: '',
      meanings: (w.translations || []).map((t, i) => ({ partOfSpeech: t.type || '', definition: a?.defs?.[i] || t.translation, example: '' })),
      translation: (w.translations || []).map(t => t.translation).join('；'),
      atlasId: a?.id || '',
      example: w.sentences?.[0] ? { en: w.sentences[0].sentence, zh: w.sentences[0].translation } : null,
      fromEpisode: '',
      fromSentenceId: null,
    });
  }

  // ── 拼写 / 默写 ─────────────────────────────────────────────────────────────
  const spell = reactive({
    active: false, input: '', wrongChar: '', wrongTimes: 0, done: false,
    hideWord: localStorage.getItem('vt_spell_hide') === 'true',
  });
  let wrongTimer = null;

  function toggleSpell() {
    spell.active = !spell.active;
    spellReset();
    if (spell.active && spell.hideWord) speak();
  }
  function toggleSpellHide() {
    spell.hideWord = !spell.hideWord;
    localStorage.setItem('vt_spell_hide', String(spell.hideWord));
    spellReset();
    if (spell.hideWord) speak();
  }
  function spellReset() {
    Object.assign(spell, { input: '', wrongChar: '', wrongTimes: 0, done: false });
    if (wrongTimer) { clearTimeout(wrongTimer); wrongTimer = null; }
  }

  const spellChars = computed(() => {
    if (!vt.word) return [];
    const typed = spell.input.length;
    return vt.word.word.split('').map((ch, i) => ({
      char: ch,
      state: i < typed ? 'ok' : (i === typed && spell.wrongChar) ? 'wrong' : 'pending',
    }));
  });

  // 错误次数 → SM-2 质量分（0错→熟、1-2→好、3-4→难、5+→忘）
  const spellQuality = n => (n === 0 ? 3 : n <= 2 ? 2 : n <= 4 ? 1 : 0);

  function spellComplete() {
    spell.done = true;
    speak();
    const item = ctx.vocabulary.value[vt.word.word.toLowerCase()];
    if (item) { ctx.applySRSQuality(item, spellQuality(spell.wrongTimes)); ctx.saveVocab(); }
    setTimeout(() => { if (spell.active && spell.done) next(); }, 1200);
  }

  function spellKey(e) {
    if (!spell.active || !vt.word || vt.loading) return false;
    const target = vt.word.word;
    if (e.key === 'Backspace') {
      spell.wrongChar = '';
      spell.input = spell.input.slice(0, -1);
      return true;
    }
    if (e.key.length !== 1 || spell.done) return false;
    const expect = target[spell.input.length];
    if (!expect) return true;
    if (e.key.toLowerCase() === expect.toLowerCase()) {
      spell.input += expect;
      spell.wrongChar = '';
      if (spell.input.length === target.length) spellComplete();
    } else {
      spell.wrongTimes += 1;
      spell.wrongChar = e.key;
      if (spell.wrongTimes === 3 && !ctx.vocabulary.value[target.toLowerCase()]) addToVocab();
      if (wrongTimer) clearTimeout(wrongTimer);
      wrongTimer = setTimeout(() => { spell.wrongChar = ''; spell.input = ''; wrongTimer = null; }, 500);
    }
    return true;
  }

  function enter() {
    vt.index = parseInt(localStorage.getItem(`vt_index_${vt.library}`) || '1', 10);
    if (!vt.word) loadWord();
  }

  function onKey(e) {
    if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return false;
    if (spell.active && spellKey(e)) { e.preventDefault(); return true; }
    if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); return true; }
    if (e.key === 'ArrowRight') { e.preventDefault(); next(); return true; }
    if (e.key === ' ') { e.preventDefault(); toggleMeaning(); return true; }
    if (e.key.toLowerCase() === 'p') { speak(); return true; }
    return false;
  }

  // 插画本身就是释义提示：释义隐藏（自测中）或默写未完成时不显示，卡片回到居中布局
  const showImg = computed(() => !!atlasMedia('thumb')
    && (vt.showMeaning || spell.done)
    && !(spell.active && spell.hideWord && !spell.done));

  return {
    vt, vtLibs: VT_LIBS, vtTotal: total, vtWordSaved: wordSaved, vtAtlas: atlas, vtAtlasTopic: atlasTopic, atlasMeta,
    vtAtlasMedia: atlasMedia, vtShowImg: showImg, vtPlayExample: playExample, vtExampleHasAudio: exampleHasAudio,
    vtSetLibrary: setLibrary, vtPrev: prev, vtNext: next, vtJump: jump, vtGo: go, vtSearch: search,
    vtToggleMeaning: toggleMeaning, vtSpeak: speak, vtAddToVocab: addToVocab,
    vtSpell: spell, vtSpellChars: spellChars, vtToggleSpell: toggleSpell, vtToggleSpellHide: toggleSpellHide,
    enterVocabTrainer: enter, vtOnKey: onKey,
  };
}
