const CACHE_NAME = "alphaopen-shell-v174";
const APP_SHELL = [
  "/", "/index.html", "/styles.css?v=67", "/app.js?v=100", "/runtime-loader.js?v=39", "/firebase-client.js?v=3", "/player-identity.js?v=1", "/lineup-bootstrap.js?v=14", "/lineup-submit.js?v=13", "/approval-bootstrap.js?v=8", "/lineup-approve.js?v=7", "/match-management-bootstrap.js?v=23", "/match-management.js?v=23", "/poster-generator.js?v=2", "/score-rules.js?v=1", "/firebase-auth.js?v=34", "/firebase-data.js?v=54", "/player-admin.js?v=33", "/identity-reconciliation.js?v=8", "/venue-admin.js?v=26", "/season-operations.js?v=1", "/season-bulk-import.js?v=7", "/season-reset.js?v=2", "/roster-admin-v3.js?v=7", "/season-structure-admin.js?v=1", "/lineup-approver-admin.js?v=4", "/lineup-update.js?v=7", "/pwa.js?v=26",
  "/manifest.webmanifest", "/assets/alphaopen-logo.png", "/assets/AlphaOpen_Season_Reload_Template.xlsx",
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
