# modern-web-guidance coverage vs resilience gaps

Checked 2026-08-12 against the installed modern-web-guidance corpus
(GoogleChromeLabs/modern-web-guidance, guides/ dir).

## Covered today (map to the fix skill directly)
- performance/ — INP causes, long tasks, task scheduling, image/script priority,
  preload priority, background fetch deprioritization, heavy-script identification
- user-experience/visually-stable-font-fallbacks.md + visually-stable-mixed-fonts.md
  — font fallback stability
- css/ — containment/content-visibility-adjacent patterns

## NOT covered — the resilience guides the fix skill must author (one+ per failure class)
1. offline-fallback — service-worker app-shell, offline UI, cache-first strategy
2. dns-network-failure — navigations/requests failing (NameNotResolved, offline),
   retry/backoff, graceful error surfaces, navigator.onLine handling
3. js-resilience — progressive enhancement, defensive init, error boundaries,
   feature detection, no hard single-bundle dependency
4. css-resilience — content usable without stylesheets, critical CSS,
   stylesheet media/onerror handling
5. font-resilience — font-display swap, preload primary font, subsetting,
   metric-compatible fallbacks (extends the two existing font guides)
6. asset-starvation — LCP prioritization + lazy loading under throttling
7. low-memory — heap reduction, content-visibility, leak hygiene (CDP leak detection)
8. backgrounding — freeze/resume, persistence, visibilitychange, SW for background sync
9. crash-recovery — state persistence + restore after tab crash/discard
10. cold-start — cache headers, SW cache, immutable assets
11. storage-quota — quota-aware persistence, graceful degradation
12. single-core — concurrency-aware worker pools

Each guide: symptoms (what the audit catches), root cause, the canonical pattern,
a before/after example, and how to re-verify with the audit harness.

## Written (2026-08-12) — all 22 guides in guides/
1. offline-fallback — SW app shell + navigation fallback
2. font-resilience — font-display swap + metric-compatible fallbacks + preload
3. js-resilience — progressive enhancement + defensive init + error surfaces
4. backgrounding-lifecycle — freeze/resume, visibilitychange persistence, wasDiscarded
5. crash-recovery — state persistence + restore after crash/discard
6. permission-denial-handling — pre-check + catch-every-rejection + degrade
7. abort-controller-timeouts — timeout every network call, cancel superseded, AbortError = control flow
8. heavy-ads-interventions — stay under the intervention budgets
9. dns-network-failure — navigations/requests failing + retry/backoff + onLine
10. third-party-dependency-resilience — first-party-first, never render-block on third parties
11. service-worker-operations — versioned caches, stable SW URL, stale-while-revalidate
12. realtime-reconnect — reconnection manager, session resume, SSE fallback
13. asset-starvation — LCP prioritization + lazy media + responsive images
14. low-memory — heap reduction, content-visibility, state persistence
15. cold-start-cache-strategy — cache headers, versioned URLs, SW runtime cache
16. css-resilience — semantic HTML, critical CSS, content usable unstyled
17. storage-quota — quota-aware writes, estimate(), rebuild-from-scratch
18. single-core — concurrency-aware pools, yield, worker fallback
19. session-recovery — 401 intercept → re-auth → retry; draft persistence
20. optimistic-ui-reconciliation — pending/confirmed, idempotency keys, rebase
21. spa-deep-link-routing — server rewrites + catch-all route
22. hydration-consistency — deterministic renders, Suspense isolation

Future (monitored): payments (sandboxed checkout), stale-SW two-version fixture,
CSP Report-Only fixture, real-engine (WebKit) testing.

Research rounds 1-2 (docs/ECOSYSTEM-RESEARCH.md + docs/RESEARCH-ROUND-2.md) add
more guide candidates: third-party-dependency-resilience, service-worker-operations
(stale caches/versioning), spa-deep-link-routing, hydration-consistency,
realtime-reconnect, checkout-idempotency, session-recovery, microfrontend-federation,
optimistic-ui-reconciliation, cache-strategy, browser-baseline.

See docs/ECOSYSTEM-RESEARCH.md for the data behind these (SW adoption ~20%,
China third-party breakpoints, font-display tradeoffs, lifecycle/discard reality,
low-memory devices).
