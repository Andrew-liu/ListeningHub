const { chromium } = require('playwright-core');
const fs = require('fs');
const BASE = process.env.BASE || 'http://localhost:8080/index.html';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROOT = require('path').resolve(__dirname, '..');
const TMP = require('os').tmpdir();

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const out = [];
  const ok = (n, c, x = '') => out.push(`${c ? 'PASS' : 'FAIL'}  ${n}  ${x}`);

  // 构造一份 LRC（用已有 VOA 篇的时间轴模拟用户导入，中英双语）
  const ep = JSON.parse(fs.readFileSync(`${ROOT}/data/listening/episodes/voa-8002695.json`, 'utf8'));
  const ts = t => `[${String(Math.floor(t / 60)).padStart(2, '0')}:${(t % 60).toFixed(2).padStart(5, '0')}]`;
  const lrc = ep.sentences.slice(0, 8).map(s => `${ts(s.t0)}${s.en}\n${ts(s.t0)}${s.zh || '中文'}`).join('\n');
  fs.writeFileSync(require('path').join(TMP, 'lh-test.lrc'), lrc);

  await page.goto(BASE);
  await page.click('nav >> text=开始练习');
  await page.click('aside >> text=我的素材');
  await page.click('text=导入音频 + 字幕');
  await page.setInputFiles('input[accept^="audio"]', `${ROOT}/audio/voa/8002695.mp3`);
  await page.setInputFiles('input[accept^=".lrc"]', require('path').join(TMP, 'lh-test.lrc'));
  await page.click('button:has-text("导入") >> nth=-1');
  await page.waitForTimeout(1500);
  const mats = await page.evaluate(() => window.__LH__.L.materials.map(m => ({ t: m.title, n: m.sentenceCount })));
  ok('导入 MP3 + 双语 LRC', mats.length === 1 && mats[0].n === 8, JSON.stringify(mats));

  await page.locator('aside .group.cursor-pointer').first().click();
  await page.waitForTimeout(800);
  await page.click('button:has-text("精听")');
  await page.click('#sent-2 span.font-mono >> nth=0');
  await page.waitForTimeout(1500);
  const st = await page.evaluate(() => { const L = window.__LH__.L; return { playing: L.playing, idx: L.activeIdx, time: L.time, t0: L.sentences[1].t0, zh: L.sentences[1].zh, src: L.current.audio.slice(0, 5) }; });
  ok('本地素材按 LRC 时间轴播放（blob）', st.playing && st.idx === 1 && st.time >= st.t0 && st.src === 'blob:' && st.zh, JSON.stringify(st));

  // 刷新后仍在（IndexedDB 持久化）
  await page.reload();
  await page.click('nav >> text=开始练习');
  await page.click('aside >> text=我的素材');
  await page.waitForTimeout(500);
  const n2 = await page.evaluate(() => window.__LH__.L.materials.length);
  ok('刷新后本地素材仍在', n2 === 1);

  // 词形还原匹配词光：rescued → rescue
  await page.click('aside >> text=VOA 精选');
  await page.locator('aside .group.cursor-pointer', { hasText: 'Australian Navy' }).first().click();
  await page.waitForTimeout(800);
  await page.click('button:has-text("精听")');
  await page.locator('#sent-1 .word-token', { hasText: 'rescued' }).click();
  await page.waitForSelector('text=加入生词本');
  const p = await page.evaluate(() => { const s = window.__LH__; return { w: s.popup.atlas?.word, cefr: s.popup.atlas?.atlas?.cefr, img: s.popupImg, tip: s.popup.atlas?.atlas?.tip?.slice(0, 30) }; });
  ok('rescued → 词光 rescue（插画+辨析）', p.w === 'rescue' && p.img, JSON.stringify(p));
  await page.keyboard.press('Escape');

  // 字幕解析单测：SRT
  const srt = await page.evaluate(async () => {
    const m = await import('./js/lib/subtitles.js');
    return m.parseSubtitles('1\n00:00:01,000 --> 00:00:03,500\nHello world.\n你好世界。\n\n2\n00:00:04,000 --> 00:00:06,000\n<i>Second</i> line\n', 'a.srt');
  });
  ok('SRT 双语解析', srt.length === 2 && srt[0].zh === '你好世界。' && srt[1].en === 'Second line' && srt[0].t1 === 3.5, JSON.stringify(srt));

  const diff = await page.evaluate(async () => {
    const m = await import('./js/lib/utils.js');
    return m.diffWords('The 44-year-old adventurer began his trip alone in October.', 'the 44 year old adventure began trip alone in october');
  });
  ok('听写 LCS 比对', diff.total === 11 && diff.correct === 9, `${diff.correct}/${diff.total}`);
  ok('无运行时错误', errors.length === 0, errors.join(' | '));
  console.log(out.join('\n'));
  await browser.close();
  process.exit(out.every(l => l.startsWith('PASS')) ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
