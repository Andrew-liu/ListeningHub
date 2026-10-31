// ListeningHub 端到端冒烟测试（复用本机 Chrome）
const { chromium } = require('playwright-core');

const BASE = process.env.BASE || 'http://localhost:8080/index.html';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const results = [];
const ok = (name, cond, extra = '') => { results.push({ name, pass: !!cond, extra }); };

(async () => {
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto(BASE);
  await page.waitForSelector('text=真人原声篇目');
  ok('首页渲染', true);

  // 进入听力
  await page.click('nav >> text=开始练习');
  await page.waitForSelector('aside >> text=VOA 精选');
  const cards = await page.locator('aside .group.cursor-pointer').count();
  ok('目录加载', cards > 10, `cards=${cards}`);

  // 打开第一篇
  await page.locator('aside .group.cursor-pointer').first().click();
  await page.waitForSelector('text=完成「');
  const title = await page.locator('main h2').first().textContent();
  ok('打开篇目', !!title, title.trim());

  // 切到精听，点第 3 句，检查真实音频按时间戳播放
  await page.click('button:has-text("精听")');
  await page.waitForSelector('#sent-3');
  await page.click('#sent-3 span.font-mono >> nth=0');
  await page.waitForTimeout(2500);
  const st = await page.evaluate(() => {
    const audios = [...document.querySelectorAll('audio')];
    return { n: audios.length };
  });
  const playInfo = await page.evaluate(() => {
    // 从 Vue 实例上读状态
    
    const L = window.__LH__.L;
    const s = L.sentences[2];
    return { playing: L.playing, time: L.time, t0: s.t0, t1: s.t1, activeIdx: L.activeIdx, mode: L.mode, src: L.current.audio };
  });
  ok('逐句播放（真人音频）', playInfo.activeIdx === 2 && playInfo.time >= playInfo.t0 - 0.2 && playInfo.time <= playInfo.t1 + 0.3,
    JSON.stringify(playInfo));

  // 等这一句播完，应自动停在 t1 附近
  const waitMs = Math.max(0, (playInfo.t1 - playInfo.time) * 1000 + 1200);
  await page.waitForTimeout(Math.min(waitMs, 25000));
  const after = await page.evaluate(() => {
    const L = window.__LH__.L;
    return { playing: L.playing, time: L.time, t1: L.sentences[2].t1 };
  });
  ok('句末自动停止', !after.playing && Math.abs(after.time - after.t1) < 0.35, JSON.stringify(after));

  // 变速 + 下一句快捷键
  await page.click('button:has-text("0.75×")');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(1500);
  const nxt = await page.evaluate(() => {
    const L = window.__LH__.L;
    const a = L.sentences[L.activeIdx];
    return { idx: L.activeIdx, rate: L.rate, time: L.time, t0: a.t0, playing: L.playing };
  });
  ok('→ 下一句 + 0.75× 变速', nxt.idx === 3 && nxt.rate === 0.75 && nxt.playing, JSON.stringify(nxt));
  await page.keyboard.press(' ');

  // 难句标记
  await page.keyboard.press('h');
  await page.waitForTimeout(200);
  const hard = await page.evaluate(() => window.__LH__.L.train.hard);
  ok('H 标记难句', hard.includes(4), JSON.stringify(hard));

  // 连续播放 + 句子高亮跟随
  await page.click('button:has-text("1×") >> nth=0');
  await page.click('button:has-text("从头整篇")');
  const firstEnd = await page.evaluate(() => window.__LH__.L.sentences[0].t1);
  await page.waitForTimeout(firstEnd * 1000 + 2500);
  const cont = await page.evaluate(() => {
    const L = window.__LH__.L;
    return { mode: L.mode, idx: L.activeIdx, time: L.time, playing: L.playing };
  });
  ok('整篇连续播放 + 高亮跟随', cont.mode === 'continuous' && cont.playing && cont.idx >= 1, JSON.stringify(cont));
  await page.keyboard.press(' ');

  // 查词弹窗（词光）
  await page.locator('#sent-1 .word-token').nth(1).click();
  await page.waitForSelector('text=加入生词本', { timeout: 15000 });
  const popupInfo = await page.evaluate(() => {
    const s = window.__LH__;
    return { word: s.popup.word, atlas: !!s.popup.atlas, img: s.popupImg, ctx: s.popup.context?.en?.slice(0, 40) };
  });
  ok('查词弹窗', popupInfo.word && popupInfo.ctx, JSON.stringify(popupInfo));
  await page.click('button:has-text("＋ 加入生词本")');
  const vocab = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('voa_vocabulary') || '{}')));
  ok('收藏生词（含原句时间戳）', vocab.length === 1 && vocab[0].context && vocab[0].context.t1 > vocab[0].context.t0, JSON.stringify(vocab[0]?.context));

  // 听写阶段
  await page.click('button:has-text("听写") >> nth=0');
  await page.waitForSelector('textarea');
  const dq = await page.evaluate(() => window.__LH__.L.dictation.queue);
  ok('进入听写自动选难句', dq.length === 1 && dq[0] === 4, JSON.stringify(dq));
  await page.fill('textarea', 'this is a wrong answer');
  await page.click('button:has-text("提交检查")');
  await page.waitForSelector('text=词正确');
  ok('听写比对', true);
  await page.click('text=结束听写');

  // 完成五个阶段 → 生成复习计划
  for (let i = 0; i < 6; i++) {
    const btn = page.locator('button:has-text("完成「")');
    if (!(await btn.count())) break;
    await btn.click();
    await page.waitForTimeout(250);
  }
  const train = await page.evaluate(() => window.__LH__.L.train);
  const hrs = (train.nextReviewAt - train.learnedAt) / 3600e3;
  ok('首学完成 → 6 小时后第 1 轮复习', train.learnedAt > 0 && Math.abs(hrs - 6) < 0.01, `stage=${train.stage} hrs=${hrs.toFixed(2)}`);

  // 背单词：词光词库
  await page.click('header >> text=背单词');
  await page.waitForSelector('text=雅思·词光');
  await page.waitForTimeout(1500);
  const vt = await page.evaluate(() => {
    const s = window.__LH__;
    const img = document.querySelector('main img, .glass-strong img');
    return { lib: s.vt.library, word: s.vt.word?.word, atlas: !!s.vt.word?.atlas, cefr: s.vt.word?.atlas?.cefr, img: img?.src, imgOk: img?.naturalWidth };
  });
  ok('背单词默认雅思·词光 + 插画', vt.lib === 'ielts' && vt.atlas && vt.imgOk > 0, JSON.stringify(vt));

  const pr = await page.evaluate(async () => {
    const m = await import('./js/lib/atlas.js');
    return m.pronounce('library', 'uk');
  });
  ok('单词发音走词光录音', pr === 'atlas', pr);

  // 其它词库仍可用
  await page.click('button:has-text("CET4")');
  await page.waitForTimeout(800);
  const cet = await page.evaluate(() => window.__LH__.vt.word?.word);
  ok('CET4 词库', !!cet, cet);

  // 生词本抽屉 + 原句回放
  await page.click('header >> text=生词本');
  await page.waitForSelector('text=我的生词本');
  ok('生词本抽屉', true);

  ok('无运行时错误', errors.filter(e => !/favicon|dictionaryapi|mymemory|ERR_ABORTED|net::ERR/i.test(e)).length === 0, errors.slice(0, 5).join(' | '));
  await browser.close();
  for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  ${r.extra}`);
  process.exit(results.every(r => r.pass) ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
