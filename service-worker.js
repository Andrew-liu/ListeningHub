/* Listening Hub Service Worker
 * - 应用代码与 JSON 数据：network-first，离线回退缓存
 * - 插画 / 字体 / CDN 脚本：cache-first
 * - 音频（mp3、Range 请求）：不拦截，交给浏览器 HTTP 缓存，避免破坏逐句 seek
 */
const CACHE_NAME = 'listening-hub-v5';
const RUNTIME = 'listening-hub-runtime-v1';
const CORE_ASSETS = [
  './',
  './index.html',
  './app.js',
  './js/lib/utils.js',
  './js/lib/segment-player.js',
  './js/lib/subtitles.js',
  './js/lib/idb.js',
  './js/lib/atlas.js',
  './js/listening/training.js',
  './js/listening/use-listening.js',
  './js/vocab/use-vocab-trainer.js',
  './data/listening/index.json',
  './data/vocab/manifest.json',
  './data/atlas/meta.json',
  './manifest.json',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(CORE_ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  const keep = [CACHE_NAME, RUNTIME];
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => !keep.includes(k)).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // 音频与外部 API 直通
  if (req.headers.has('range') || /\.(mp3|m4a|wav|ogg|webm)$/i.test(url.pathname)) return;
  if (url.host.includes('dictionaryapi.dev') || url.host.includes('mymemory.translated.net')) return;

  const sameOrigin = url.origin === self.location.origin;
  const isCore = sameOrigin && (/\.(html|js|json)$/.test(url.pathname) || url.pathname.endsWith('/'));
  if (isCore) {
    event.respondWith(
      fetch(req).then(res => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() => caches.match(req)),
    );
    return;
  }

  // 插画、字体、CDN：cache-first
  if (/\.(webp|png|jpg|svg|woff2?)$/i.test(url.pathname) || /unpkg\.com|cdn\.tailwindcss\.com|fonts\.(googleapis|gstatic)\.com|raw\.githubusercontent\.com/.test(url.host)) {
    event.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        if (res && (res.status === 200 || res.type === 'opaque')) {
          const copy = res.clone();
          caches.open(RUNTIME).then(c => c.put(req, copy));
        }
        return res;
      })),
    );
  }
});
