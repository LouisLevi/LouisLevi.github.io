/* Meine Fixkosten - Service Worker: App komplett offline nutzbar.
   Seiten, Skript, Styles und Manifest: Netz zuerst (damit Updates ankommen), Cache als Offline-Fallback.
   Icons: Cache zuerst (sie aendern sich nie). */
var CACHE = 'fixkosten-v4';
var ASSETS = [
  'index.html',
  'teilen.html',
  'style.css',
  'app.js',
  'manifest.webmanifest',
  'icon-180.png',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) { return cache.addAll(ASSETS); }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

function networkFirst(request, cacheKey) {
  return fetch(request).then(function (response) {
    if (response && response.ok) {
      var copy = response.clone();
      caches.open(CACHE).then(function (cache) { cache.put(cacheKey || request, copy); });
    }
    return response;
  }).catch(function () {
    return caches.match(cacheKey || request);
  });
}

function cacheFirst(request) {
  return caches.match(request).then(function (hit) {
    return hit || fetch(request).then(function (response) {
      if (response && response.ok && request.url.indexOf(self.location.origin) === 0) {
        var copy = response.clone();
        caches.open(CACHE).then(function (cache) { cache.put(request, copy); });
      }
      return response;
    });
  });
}

self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') return;
  var url = event.request.url;

  if (event.request.mode === 'navigate') {
    // Cache-Schluessel ohne URL-Anhaenger (#...): der Anhaenger kann geteilte Daten
    // enthalten und gehoert nicht in den Cache. Er wird ohnehin nie zum Server gesendet.
    var cleanUrl = event.request.url.split('#')[0];
    event.respondWith(
      fetch(event.request).then(function (response) {
        if (response && response.ok) {
          var copy = response.clone();
          caches.open(CACHE).then(function (cache) { cache.put(cleanUrl, copy); });
        }
        return response;
      }).catch(function () {
        return caches.match(cleanUrl).then(function (hit) {
          return hit || caches.match('index.html');
        });
      })
    );
    return;
  }
  if (url.indexOf(self.location.origin) === 0 && /icon-\d+\.png|icon-maskable-\d+\.png/.test(url)) {
    event.respondWith(cacheFirst(event.request));
    return;
  }
  if (url.indexOf(self.location.origin) === 0) {
    event.respondWith(networkFirst(event.request));
  }
});
