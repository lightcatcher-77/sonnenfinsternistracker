/*
 * Service Worker - macht den Tracker offline nutzbar.
 * Wichtig fuer den Finsternistag selbst: draussen auf dem Feld ist das Netz
 * oft ueberlastet, die App muss trotzdem laufen.
 */
var CACHE = 'sofi2026-v3';

var ASSETS = [
  './',
  './index.html',
  './assets/css/style.css',
  './assets/js/eclipse-core.js',
  './assets/js/cities.js',
  './assets/js/app.js',
  './manifest.webmanifest',
  './assets/icon.svg',
  './assets/icon-180.png',
  './assets/icon-192.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(ASSETS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;

  // Netz zuerst, Cache als Rueckfall - so bleiben Updates sichtbar,
  // ohne dass die App offline ausfaellt.
  e.respondWith(
    fetch(e.request).then(function (res) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
      return res;
    }).catch(function () {
      return caches.match(e.request).then(function (hit) {
        return hit || caches.match('./index.html');
      });
    })
  );
});
