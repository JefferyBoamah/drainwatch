'use strict';
// Change the version when you change any file in /public, or phones will keep the old copy.
const SHELL_CACHE = 'dw-shell-v5';
const API_CACHE = 'dw-api-v5';

const CORE = [
  '/index.html', '/join.html', '/login.html', '/crew.html', '/admin.html', '/offline.html',
  '/common.js', '/auth.js', '/report.js', '/crew.js', '/admin.js', '/manifest.json'
];
// These may be missing (the deployer supplies them) or slow; they must not block the install.
const OPTIONAL = [
  '/style.css', '/icon-192.png', '/icon-512.png',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js'
];
const NETWORK_FIRST = ['/api/landmarks', '/api/ranking'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await cache.addAll(CORE);
    await Promise.all(OPTIONAL.map((url) => {
      const request = url.startsWith('http') ? new Request(url, { mode: 'no-cors' }) : url;
      return cache.add(request).catch((err) => console.warn('Optional file not cached: ' + url, err));
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n !== SHELL_CACHE && n !== API_CACHE).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

async function networkFirst(request) {
  const cache = await caches.open(API_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch (err) {
    const saved = await cache.match(request);
    if (saved) return saved;
    return new Response(JSON.stringify({ error: 'network' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
  }
}

async function cacheFirst(request, isPage) {
  const cache = await caches.open(SHELL_CACHE);
  const url = new URL(request.url);
  const key = isPage && url.pathname === '/' ? '/index.html' : request;
  const saved = await cache.match(key, { ignoreSearch: isPage });
  if (saved) return saved;
  try {
    const response = await fetch(request);
    if (response.ok || response.type === 'opaque') await cache.put(request, response.clone());
    return response;
  } catch (err) {
    if (isPage) {
      const offline = await cache.match('/offline.html');
      if (offline) return offline;
    }
    return Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return; // POST, PUT and DELETE always go straight to the network.
  const url = new URL(request.url);
  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith('/api/')) {
      if (NETWORK_FIRST.includes(url.pathname)) event.respondWith(networkFirst(request));
      return;
    }
    event.respondWith(cacheFirst(request, request.mode === 'navigate'));
  } else if (url.hostname === 'cdnjs.cloudflare.com') {
    event.respondWith(cacheFirst(request, false));
  }
});

// The queue lives in the page (IndexedDB plus the sign-in token), so the worker asks open pages to send it.
self.addEventListener('sync', (event) => {
  if (event.tag !== 'flush-queue') return;
  event.waitUntil((async () => {
    const pages = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    pages.forEach((page) => page.postMessage({ type: 'flush-queue' }));
  })());
});