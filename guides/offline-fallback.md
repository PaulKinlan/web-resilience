# Guide: Offline Fallback (service worker app shell)

**Failure class:** `offline-fallback`, `dns-fallback`
**Audit scenario:** `offline`, `dns-fail`
**Symptom the audit catches:** under `offline` or `dns-fail` the page shows the
browser error page ("This site can't be reached", "Checking the network
cables") instead of any site content; `networkFailures` contains
`net::ERR_INTERNET_DISCONNECTED` / `net::ERR_NAME_NOT_RESOLVED` and the page
text sample is the browser neterror text.

## Root cause
No service worker (or a SW with no shell/precache): every navigation depends on
the network, so DNS interception, a downed origin, or offline = blank browser
error page. Users on flaky/blocked networks (GFW, tunnels, transit) see nothing.

## Canonical pattern
1. **Precache the app shell** on install (`caches.addAll(["/", "/index.html", "/styles.css"])` —
   make paths scope-relative: `new URL("./", self.registration.scope)`).
2. **Navigation fallback:** in `fetch`, for `req.mode === "navigate"` respond with
   `fetch(req).catch(() => caches.match(shell))`.
3. **Runtime cache** for same-origin GETs (stale-while-revalidate or cache-first).
4. **Skip-waiting + clients.claim()** so the SW controls the page immediately.
5. Register defensively: `navigator.serviceWorker.register("./sw.js").catch(() => {})`.

## Before / after (this repo's fixtures)
- `fixtures/resilient-club` — no SW: offline → browser error page.
- `fixtures/reference` — SW shell: offline + dns-fail → "Resilient Club" shell
  renders (verified by the eval harness).

## Re-verify
```bash
deno run -A harness/run-scenario.ts <url> --scenario offline --screenshot
# pass: page text is your shell content, not the neterror page
```

## Notes
- One guide per failure case is not enough: pair this with **offline UI**
  (an explicit "you're offline — core features still work" surface) and
  **state sync** (queue writes, sync on `online`).
