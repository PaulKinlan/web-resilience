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
