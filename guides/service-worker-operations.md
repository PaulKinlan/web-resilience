# Guide: Service Worker Operations (stale caches, versioning, lifecycle)

**Failure class:** `offline-fallback` (operational)
**Audit scenarios:** `sw-bypass`, `sw-stop`, `sw-unregister`, `offline`, `no-cache`
**Symptom:** stale content served after deploy; old tabs run old workers; the
page breaks when the SW is stopped/unregistered; cache grows unbounded.

## Root cause
SW lifecycle/versioning mistakes: unversioned cache keys, no old-cache cleanup,
changing the SW URL, over-precaching, waiting-worker confusion.

## Canonical pattern
1. Versioned cache names + delete old caches in `activate`.
2. Keep the SW URL stable; `skipWaiting` + `clients.claim()` only when the
   migration model allows (or the SW updates per-tab).
3. `stale-while-revalidate` for dynamic assets (fresh + fast); hashed/immutable
   URLs for static (long cache + cache-first).
4. Never precache more than the shell needs.
5. Handle `sw-stop`/`sw-unregister` gracefully: the page works WITHOUT the SW
   (the no-SW path is a first-class state).

## Re-verify
`deno run -A harness/run-scenario.ts <url> --scenario sw-bypass` + `sw-stop` — pass: page fully functional without the SW.
