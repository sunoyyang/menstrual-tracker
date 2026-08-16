const CACHE = 'cycle-tracker-v2';
const ASSETS = ['./', './index.html', './styles.css', './app.js', './icon-180.png', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

/* network-first：优先请求网络（确保代码/数据逻辑更新即时生效），
   网络不可用时回退到缓存（离线也能打开） */
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then((resp) => {
      const cp = resp.clone();
      caches.open(CACHE).then((c) => c.put(e.request, cp));
      return resp;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html')))
  );
});
