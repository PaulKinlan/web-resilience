// FIXED: offline shell — scope-relative precache; navigations get the cached
// shell when the network fails. Works from any mount path (/reference/ etc.).
const scope = new URL("./", self.registration.scope).pathname;
const SHELL = [scope, scope + "index.html", scope + "styles.css", scope + "app.js"];
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open("shell-v1").then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
self.addEventListener("fetch", (event) => {
  const req = event.request;
  // Network-first, with an honest marker on failure. The generic handler below
  // would fall back to index.html for this, which the page would try to parse
  // as JSON — a cached response disguised as a live one. Say which it is.
  if (new URL(req.url).pathname.endsWith("/api/live.json")) {
    event.respondWith(
      fetch(req).catch(() =>
        new Response(JSON.stringify({ mode: "cached" }), {
          headers: { "content-type": "application/json" },
        })
      ),
    );
    return;
  }
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() => caches.match(scope + "index.html").then((r) => r || caches.match(scope))),
    );
    return;
  }
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((res) => {
      const copy = res.clone();
      caches.open("runtime-v1").then((c) => c.put(req, copy));
      return res;
    }).catch(() => caches.match(scope + "index.html"))),
  );
});
