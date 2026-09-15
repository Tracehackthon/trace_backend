// Trace local-first web workspace — minimal offline asset cache.
// API requests (/api/web/*) and dynamic ES module fetches always go to the network.
const CACHE = 'trace-web-v1';
const PRECACHE = [
  './',
  './index.html',
  './legacy.html',
  './src/web-main.js',
  './src/main.js',
  './src/home.js',
  './src/home-model.js',
  './src/home-icons.js',
  './src/home.css',
  './src/home/scene-glass.js',
  './src/style.css',
  './src/matters/matters-screen.mjs',
  './src/matters/matters-model.mjs',
  './src/matters/matters.css',
  './src/product/bridge.mjs',
  './src/product/library.mjs',
  './src/product/assets.mjs',
  './src/product/chain-screen.mjs',
  './src/product/chain-model.mjs',
  './src/product/chain-helpers.mjs',
  './src/product/chain.css',
  './src/product/comparison-screen.mjs',
  './src/product/comparison-model.mjs',
  './src/product/comparison.css',
  './src/product/worksite-screen.mjs',
  './src/product/worksite-model.mjs',
  './src/product/worksite-icons.mjs',
  './src/product/worksite.css',
  './src/product/web.css',
  './src/vendor/anime.esm.js',
  './src/vendor/shape-only.mjs',
  './public/home/environment.png',
  './public/home/bird-perched.png',
  './public/home/bird-takeoff.png',
  './public/home/fonts/TraceHomeSerif-fixed.woff2',
  './public/home/fonts/TraceHomeSans-fixed.woff2',
  './public/product/fonts/TraceSerif.woff2',
  './public/product/fonts/TraceSans.ttf',
  './public/matters/environment.png',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(PRECACHE).catch(() => undefined)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // never cache workspace state
  event.respondWith((async () => {
    try {
      const fresh = await fetch(req);
      if (fresh.ok && (req.destination === 'script' || req.destination === 'style' || req.destination === 'image' || req.destination === 'font')) {
        const cache = await caches.open(CACHE);
        cache.put(req, fresh.clone());
      }
      return fresh;
    } catch {
      const cached = await caches.match(req);
      if (cached) return cached;
      if (req.mode === 'navigate') {
        const fallback = await caches.match('./index.html');
        if (fallback) return fallback;
      }
      return new Response('', { status: 504, statusText: 'Offline' });
    }
  })());
});