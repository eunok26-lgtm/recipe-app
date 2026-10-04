const CACHE = 'recipe-note-v11';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'import.js', 'sync.js', 'manifest.json', 'icon-192.png', 'icon-180.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// 우리 파일은 네트워크 먼저(업데이트가 바로 보이게), 안 되면 캐시.
// GitHub Pages 는 브라우저가 10분간 파일을 재사용하게 하므로 no-cache 로 매번 서버에 새 버전이 있는지 확인한다.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' }).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('./')))
  );
});
