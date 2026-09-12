const CACHE_NAME = 'phu-gia-land-v66';
const isTenantPortal = self.location.hostname.startsWith('tenant.') || self.location.hostname.startsWith('tentant.');
const APP_SHELL = isTenantPortal ? [
  './',
  './tenant.html?v=66',
  './tenant.css?v=66',
  './vietnamese-typography.css?v=66',
  './tenant.js?v=66',
  './tenant.webmanifest?v=66',
  './assets/pwa-icon-192.png',
  './assets/pwa-icon-512.png',
  './assets/Logo BPG.jpg'
] : [
  './',
  './index.html?v=66',
  './styles.css?v=66',
  './modal.css?v=66',
  './enhancements.css?v=66',
  './redesign.css?v=66',
  './crud.css?v=66',
  './utility-manager.css?v=66',
  './vietnamese-typography.css?v=66',
  './building-form.css?v=66',
  './building-manager.css?v=66',
  './homestay.css?v=66',
  './customer-manager.css?v=66',
  './customer-detail.css?v=66',
  './vp-theme.css?v=66',
  './app.js?v=66',
  './manifest.webmanifest?v=66',
  './assets/pwa-icon-192.png',
  './assets/pwa-icon-512.png',
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
    event.respondWith(fetch(event.request, { cache: 'no-store' }).then((response) => {
      if (response.ok && !response.redirected) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
      }
      return response;
    }).catch(() => caches.match(event.request).then((cached) => cached || caches.match(isTenantPortal ? './tenant.html' : './index.html'))));
    return;
  }
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
      if (new URL(event.request.url).origin === self.location.origin) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
      }
      return response;
    }).catch(() => caches.match(isTenantPortal ? './tenant.html' : './index.html')))
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
