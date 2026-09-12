const CACHE_NAME = 'phu-gia-land-v76';
const isTenantPortal = self.location.hostname.startsWith('tenant.') || self.location.hostname.startsWith('tentant.');
const APP_SHELL = isTenantPortal ? [
  './',
  './tenant.html?v=73',
  './tenant.css?v=73',
  './vietnamese-typography.css?v=73',
  './tenant.js?v=73',
  './tenant.webmanifest?v=73',
  './assets/pwa-icon-192.png',
  './assets/pwa-icon-512.png',
  './assets/Logo BPG.jpg'
] : [
  './',
  './index.html?v=73',
  './styles.css?v=73',
  './modal.css?v=73',
  './enhancements.css?v=73',
  './redesign.css?v=73',
  './crud.css?v=73',
  './utility-manager.css?v=73',
  './vietnamese-typography.css?v=73',
  './building-form.css?v=73',
  './building-manager.css?v=73',
  './homestay.css?v=73',
  './customer-manager.css?v=73',
  './customer-detail.css?v=73',
  './vp-theme.css?v=73',
  './app.js?v=73',
  './manifest.webmanifest?v=73',
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
