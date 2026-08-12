// FIXED: offline shell — precache the app shell + fallback page; navigation
// requests get the cached shell when the network fails.
const SHELL = ["/", "/index.html", "/styles.css"];
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open("shell-v1").then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() => caches.match("/index.html").then((r) => r || caches.match("/"))),
    );
    return;
  }
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((res) => {
      const copy = res.clone();
      caches.open("runtime-v1").then((c) => c.put(req, copy));
      return res;
    }).catch(() => caches.match("/index.html"))),
  );
});
