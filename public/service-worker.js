const CACHE = 'script-studio-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192x192.png',
  '/icon-512x512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = e.request.url;

  // API / 외부 요청 / non-GET → 네트워크로 직접 통과
  if (
    e.request.method !== 'GET' ||
    url.includes('/api/') ||
    url.includes('supabase.co') ||
    url.includes('chrome-extension') ||
    url.includes('fonts.googleapis.com') ||
    url.includes('cdn.jsdelivr.net')
  ) {
    e.respondWith(fetch(e.request));  // return 대신 명시적으로 네트워크 통과
    return;
  }

  e.respondWith(
    caches.match(e.request).then(cached => {
      const network = fetch(e.request).then(res => {
        if (res.ok && res.type !== 'opaque') {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
