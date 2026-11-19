// Offline-Fähigkeit: App-Dateien zwischenspeichern
const VERSION = 'lernlauscher-v1';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/ai.js', 'js/core.js', 'js/db.js', 'js/pipeline.js', 'js/recorder.js', 'js/scan.js', 'js/sheet.js', 'js/ui.js',
  'js/views-learn.js', 'js/views-lesson.js', 'js/views-sheets.js',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
];
const PDF_LIB = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // KI-Anfragen nie zwischenspeichern
  if (url.hostname.endsWith('googleapis.com')) return;
  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin && e.request.url !== PDF_LIB) return;
  // Erst Netz (für Updates), bei Offline aus dem Speicher
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html')))
  );
});
