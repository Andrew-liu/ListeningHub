/* Listening Hub Service Worker v3 - network-first for HTML/JS, cache-first for others */
const CACHE_NAME = 'listening-hub-v3';
const CORE_ASSETS = [
  './',
  './index.html',
  './app.js',
  './data/episodes.js',
  './manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 1) API 不缓存，直通
  if (url.host.includes('dictionaryapi.dev') || url.host.includes('mymemory.translated.net')) {
    return;
  }

  // 2) 应用核心文件（HTML / JS / JSON）：network-first，失败回退缓存
  //    这样新版本发布后可以立刻生效，仅在离线时才读缓存
  const isCore = /\.(html|js|json)$/.test(url.pathname) || url.pathname.endsWith('/');
  if (url.origin === self.location.origin && isCore) {
    event.respondWith(
      fetch(req).then((res) => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return res;
      }).catch(() => caches.match(req))
    );
    return;
  }

  // 3) 其他静态资源（字体、CDN）：cache-first
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res && res.status === 200 && url.origin === self.location.origin) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return res;
      }).catch(() => cached);
    })
  );
});
