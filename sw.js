/* Service Worker：離線也能看行程。
 * - App shell + 行程資料：安裝時預先快取（cache-first）
 * - 地圖圖磚：看過的區域快取起來（cache-first，最多 ~600 張）
 * - OSRM / Open-Meteo：network-first，離線時回傳快取
 */
const VERSION = 'v1.1.0';
const SHELL = `shell-${VERSION}`;
const TILES = 'tiles-v1';
const API = 'api-v1';
const SHELL_FILES = [
  './', './index.html', './css/style.css', './js/app.js', './data/itinerary.json',
  './manifest.webmanifest', './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png'
];
const EXTERNAL_FILES = [
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];
const TILE_LIMIT = 600;

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(SHELL).then(async c => {
      await c.addAll(SHELL_FILES);
      // 外部資源盡力快取，失敗不阻擋安裝
      await Promise.all(EXTERNAL_FILES.map(u => c.add(u).catch(() => null)));
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('shell-') && k !== SHELL).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;

  if (url.hostname.endsWith('tile.openstreetmap.org')) {
    e.respondWith(cacheFirst(TILES, e.request, TILE_LIMIT));
    return;
  }
  if (url.hostname === 'upload.wikimedia.org') {
    e.respondWith(cacheFirst(TILES, e.request, TILE_LIMIT));
    return;
  }
  if (url.hostname.includes('project-osrm.org') || url.hostname.includes('open-meteo.com')) {
    e.respondWith(networkFirst(API, e.request));
    return;
  }
  // 同網域檔案：network-first，這樣每次部署都會拿到新版；離線時回退快取
  if (url.origin === location.origin) {
    e.respondWith(networkFirst(SHELL, e.request));
    return;
  }
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      if (res.ok && url.hostname === 'unpkg.com') {
        const copy = res.clone();
        caches.open(SHELL).then(c => c.put(e.request, copy));
      }
      return res;
    }))
  );
});

async function cacheFirst(name, req, limit) {
  const c = await caches.open(name);
  const hit = await c.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok) { c.put(req, res.clone()); trim(c, limit); }
    return res;
  } catch {
    return new Response('', { status: 504 });
  }
}

async function networkFirst(name, req) {
  const c = await caches.open(name);
  try {
    const res = await fetch(req);
    if (res.ok) c.put(req, res.clone());
    return res;
  } catch {
    const hit = await c.match(req);
    return hit || new Response(JSON.stringify({ code: 'Offline' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
  }
}

async function trim(cache, limit) {
  const keys = await cache.keys();
  if (keys.length <= limit) return;
  await Promise.all(keys.slice(0, keys.length - limit).map(k => cache.delete(k)));
}
