// 生成 README 演示截图：npm run serve 后执行 npm run screenshots
const { chromium } = require('playwright-core');
const path = require('path');

const BASE = process.env.BASE || 'http://localhost:8080/index.html';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.resolve(__dirname, '..', 'docs', 'images');
const EP = 'voa-8002695'; // Australian Navy Rescues Rower Crossing Pacific from California

async function open(browser, { theme = 'light', width = 1440, height = 900, scale = 1 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale });
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.evaluate(t => { localStorage.clear(); localStorage.setItem('voa_theme', t); }, theme);
  await page.reload();
  await page.waitForSelector('text=真人原声篇目');
  return page;
}

async function openEpisode(page) {
  await page.click('nav >> text=开始练习');
  await page.waitForFunction(() => window.__LH__ && window.__LH__.L.catalog.length > 0);
  await page.evaluate(async id => {
    const L = window.__LH__.L;
    await L.openEpisode(L.catalog.find(e => e.id === id));
  }, EP);
  await page.waitForSelector('text=完成「');
}

async function shot(page, name) {
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, name) });
  console.log('saved', name);
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });

  // 1. 首页
  let page = await open(browser);
  await shot(page, 'home.png');

  // 2. 精听：第 4 句高亮，标两句难句
  await openEpisode(page);
  await page.click('button:has-text("精听")');
  await page.evaluate(() => {
    const L = window.__LH__.L;
    L.toggleHard(L.sentences[6]);
    L.toggleHard(L.sentences[10]);
  });
  await page.click('#sent-4 span.font-mono >> nth=0');
  await page.waitForTimeout(1800);
  await page.keyboard.press(' ');
  await shot(page, 'listening.png');

  // 3. 查词弹窗（词光插画 + 原句）
  await page.locator('#sent-1 .word-token', { hasText: 'rescued' }).click();
  await page.waitForSelector('text=加入生词本');
  await page.waitForTimeout(800);
  await shot(page, 'word-popup.png');
  await page.keyboard.press('Escape');

  // 4. 听写比对
  await page.click('button:has-text("听写") >> nth=0');
  await page.waitForSelector('textarea');
  await page.evaluate(() => window.__LH__.L.startDictation([3]));
  await page.waitForSelector('textarea');
  await page.fill('textarea', 'The 44 year old adventure began his trip alone in October from San Diego California');
  await page.click('button:has-text("提交检查")');
  await page.waitForSelector('text=词正确');
  await page.evaluate(() => window.__LH__.L.stopAll());
  await shot(page, 'dictation.png');

  // 5. 背单词：词光雅思卡片
  await page.evaluate(() => window.__LH__.L.closeDictation());
  await page.click('header >> text=背单词');
  await page.waitForSelector('text=雅思·词光');
  await page.fill('input[type=search]', 'rescue');
  await page.click('button:has-text("搜索")');
  await page.waitForSelector('text=已跳转到 rescue');
  await page.waitForTimeout(1200);
  await shot(page, 'vocab.png');
  await page.context().close();

  // 6. 暗色模式
  page = await open(browser, { theme: 'dark' });
  await openEpisode(page);
  await page.click('button:has-text("精听")');
  await page.click('#sent-2 span.font-mono >> nth=0');
  await page.waitForTimeout(1500);
  await page.keyboard.press(' ');
  await shot(page, 'listening-dark.png');
  await page.context().close();

  // 7. 手机端
  page = await open(browser, { width: 390, height: 844, scale: 2 });
  await openEpisode(page);
  await page.click('button:has-text("精听")');
  await page.waitForTimeout(400);
  await shot(page, 'mobile.png');

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
