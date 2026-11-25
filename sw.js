const CACHE = 'starfleet-tactics-v20';
const ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/setup.js',
  './js/game.js',
  './js/board.js',
  './js/data.js',
  './js/ships.js',
  './js/fx.js',
  './js/asteroids.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './assets/ships/ca.png',
  './assets/ships/ff.png',
  './assets/ships/d7.png',
  './assets/ships/f5.png',
  './assets/asteroids/a.png',
  './assets/asteroids/b.png',
  './assets/asteroids/c.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
