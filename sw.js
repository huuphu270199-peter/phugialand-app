const CACHE_NAME = 'phu-gia-land-v59';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './modal.css',
  './enhancements.css',
  './redesign.css',
  './crud.css',
  './utility-manager.css',
  './vietnamese-typography.css',
  './building-form.css',
  './building-manager.css',
  './customer-manager.css',
  './customer-detail.css',
  './vp-theme.css',
  './app.js',
  './manifest.webmanifest',
  './assets/Logo BPG.jpg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const requestUrl = new URL(event.request.url);
  if (requestUrl.pathname.startsWith('/api/')) {
    event.respondWith(fetch(event.request));
    return;
  }
  const isAppCode = event.request.mode === 'navigate' || /\.(?:html|js|css)$/i.test(requestUrl.pathname);
  if (isAppCode) {
    event.respondWith(fetch(event.request).then((response) => {
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
      return response;
    }).catch(() => caches.match(event.request).then((cached) => cached || caches.match('./index.html'))));
    return;
  }
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
      if (new URL(event.request.url).origin === self.location.origin) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
      }
      return response;
    }).catch(() => caches.match('./index.html')))
  );
});

self.addEventListener('push', (event) => {
  const data = event.data?.json() || { title: 'Phú Gia Land', body: 'Bạn có thông báo mới.' };
  event.waitUntil(self.registration.showNotification(data.title, { body: data.body, icon: './assets/Logo%20BPG.jpg', badge: './assets/Logo%20BPG.jpg', data: { url: data.url || './' } }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data?.url || './'));
});
