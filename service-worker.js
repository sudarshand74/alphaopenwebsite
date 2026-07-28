const CACHE_NAME = "alphaopen-shell-v252";
const APP_SHELL = [
  "/", "/index.html", "/styles.css?v=83", "/lineup-workflow.css?v=1", "/app.js?v=129", "/runtime-loader.js?v=94", "/firebase-client.js?v=5", "/player-identity.js?v=5", "/public-season-dashboard.js?v=15", "/season-public-sync.js?v=1", "/ao-content.js?v=2", "/lineup-bootstrap.js?v=20", "/lineup-submit.js?v=20", "/lineup-workflow-client.js?v=4", "/approval-bootstrap.js?v=16", "/lineup-approve.js?v=15", "/lineup-reset-bootstrap.js?v=3", "/lineup-reset.js?v=3", "/ec-lineup-status-bootstrap.js?v=2", "/ec-lineup-status.js?v=2", "/match-management-bootstrap.js?v=34", "/match-management.js?v=34", "/poster-generator.js?v=4", "/score-rules.js?v=1", "/firebase-auth.js?v=42", "/firebase-data.js?v=87", "/player-admin.js?v=45", "/identity-reconciliation.js?v=11", "/venue-admin.js?v=26", "/season-operations.js?v=2", "/season-bulk-import.js?v=18", "/season-reset.js?v=3", "/roster-admin-v3.js?v=20", "/season-structure-admin.js?v=10", "/operations-access-admin.js?v=1", "/lineup-approver-admin.js?v=4", "/lineup-update.js?v=15", "/pwa.js?v=26",
  "/manifest.webmanifest", "/assets/alphaopen-logo.png", "/assets/AlphaOpen_Season_Reload_Template.xlsx",
  "/assets/icon-192.png", "/assets/icon-512.png",
  "/assets/community-2026-group-banner.jpg", "/assets/community-2026-patio.jpg",
  "/assets/community-2026-league-banner.jpg", "/assets/community-2026-night-court.jpg",
  "/assets/community-2026-day-gathering.jpg", "/assets/community-2026-court-banner.jpg",
  "/assets/community-2026-court-group.jpg", "/assets/community-2026-award-lineup.jpg",
  "/assets/community-2026-award-team.jpg"
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
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/__/")) return;

  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(() => caches.match("/index.html")));
    return;
  }

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
