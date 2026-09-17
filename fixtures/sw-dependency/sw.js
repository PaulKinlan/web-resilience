// sw-dependency fixture — the worker the app cannot live without.
//
// It answers /sw-dependency/api/stock, a route the origin server does not
// have. That is the whole point of the fixture: the app's data path exists
// only while this worker is alive.
//
// SEEDED ISSUE 3: one hardcoded cache name, no version cleanup, cache-first
// with no revalidation. A returning visitor is served the old shell forever.

var CACHE = "depot-cache"; // never versioned, never cleaned up

var SHELL = [
  "/sw-dependency/",
  "/sw-dependency/index.html",
  "/sw-dependency/app.js",
  "/sw-dependency/styles.css",
];

var STOCK = [
  { name: "Blue widget", count: 12 },
  { name: "Red widget", count: 3 },
  { name: "Green widget", count: 41 },
];

self.addEventListener("install", function (event) {
  event.waitUntil(caches.open(CACHE).then(function (cache) {
    return cache.addAll(SHELL);
  }));
  // No skipWaiting: an updated worker waits behind every open tab.
});

self.addEventListener("activate", function (event) {
  // No cleanup of old caches, and no clients.claim().
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", function (event) {
  var url = new URL(event.request.url);

  // The synthesized endpoint. Nothing else can answer this.
  if (url.pathname === "/sw-dependency/api/stock") {
    event.respondWith(new Response(JSON.stringify(STOCK), {
      headers: { "content-type": "application/json" },
    }));
    return;
  }

  // Cache-first with no revalidation — the stale-shell defect.
  event.respondWith(
    caches.match(event.request).then(function (hit) {
      return hit || fetch(event.request);
    }),
  );
});
