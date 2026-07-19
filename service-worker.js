const CACHE_NAME = "alphaopen-shell-v39";
const APP_SHELL = [
  "/", "/index.html", "/styles.css?v=43", "/workflow-mockup.css?v=1", "/app.js?v=50", "/workflow-mockup.js?v=2", "/fall-workflow-data.json", "/runtime-loader.js?v=1", "/firebase-auth.js?v=28", "/firebase-data.js?v=33", "/player-admin.js?v=27", "/venue-admin.js?v=26", "/season-operations.js?v=1", "/roster-admin-v3.js?v=3", "/pwa.js?v=26",
  "/manifest.webmanifest", "/assets/alphaopen-logo.png",
  "/assets/icon-192.png", "/assets/icon-512.png",
  "/assets/ao-community.jpeg", "/assets/community-patio.jpg", "/assets/community-group.jpg",
  "/assets/community-night-court.jpg", "/assets/community-day-group.jpg", "/assets/community-banner-team.jpg",
  "/assets/community-court-group.jpg", "/assets/community-bottle.jpg", "/assets/community-awards.jpg",
  "/assets/community-trophies.jpg", "/assets/community-katta.jpg"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== location.origin) return;

  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(() => caches.match("/index.html")));
    return;
  }

  const url = new URL(event.request.url);
  const isAppCode = ["script", "style", "worker"].includes(event.request.destination)
    || url.pathname.endsWith(".webmanifest");

  if (isAppCode) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
      const copy = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
      return response;
    }))
  );
});
