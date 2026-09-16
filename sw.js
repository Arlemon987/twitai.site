const CACHE_NAME = "twit-ai-v1";

self.addEventListener("install", event => {
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    self.clients.claim()
  );
});

self.addEventListener("fetch", event => {
  // Let Firebase Auth redirects and navigation requests pass through.
  if (event.request.mode === "navigate") {
    return;
  }

  // Do not interfere with API requests.
  if (event.request.url.includes("/api/")) {
    return;
  }

  event.respondWith(
    fetch(event.request).catch(() => {
      return caches.match(event.request);
    })
  );
});
