# Ecosystem Research: resilience challenges on the real web

Deep research (2026-08-12) on the failure states the audit matrix targets,
grounded in the Chrome DevTools Protocol surface. Each challenge is mapped to
the scenario(s) that test it. Sources at the bottom.

## 1. Offline / service-worker adoption — the biggest gap

- **~20% of websites ship a service worker** (HTTP Archive 2025; desktop
  ~18.9–20.5%, mobile ~20.0%); top-1k sites ~30%. **~80% of the web cannot
  serve anything offline**, on DNS failure, or during an origin outage.
- Web app manifests: ~9%. Both together: ~3.3–3.5%.
- **"Slow is down":** 42% of surveyed orgs treat slow apps as equivalent to
  downtime; 73% say performance is critical. Median outage ~1.9 min, 98.6%
  recover <1h, but 0.3% of incidents exceed 6h — the heavy tail is where
  resilience pays.
- Patterns that work: cache-on-install (static shell), cache-on-response
  (dynamic assets), cache-first / network-first / cache-then-network, generic
  fallbacks (web.dev offline cookbook; W3C SW spec).

**Audit mapping:** `offline`, `dns-fail`, `no-cache`. Pass = the shell renders
under offline/dns-fail (see fixtures/reference — verified by the eval).

## 2. DNS interception & the Great Firewall (China case)

- China presents as **DNS poisoning, IP blocking, DPI, URL filtering, VPN
  detection** — often as timeouts/long waits, not clean block pages.
- **Third-party dependencies (Google/Facebook-stack assets) are the most
  common breakpoints** for users in China even when the first-party origin is
  healthy — a first-party site can be fine while its CDN/analytics/font stack
  stalls the page.
- Broad/domain-level filtering: one large-scale study (Usenix '21) + GreatFire
  analyzer report ~28% of ~700k sampled URLs blocked; censored domains number
  in the hundreds of thousands.
- In-country monitoring is required; external-only checks miss localized
  DNS/route/blocking failures.

**Audit mapping:** `dns-fail` (per-request `NameNotResolved` via
`Fetch.failRequest` — the exact injection), `block-js`/`block-css`/`block-fonts`
(the third-party-asset case), `throttled-slow` (timeout-like experience).
**Fix implications:** no hard dependency on third-party hosts (self-host or
fallback), SW shell + fallbacks so first-party core survives, defensive init.

## 3. Font loading — FOIT, swap, and CLS

- Fonts directly drive FCP/LCP/CLS. `font-display: block` (default) **delays
  text up to 2–3 seconds** (FOIT); `swap` shows text immediately but can shift
  layout on swap; `optional` never swaps (fastest, but custom font may never
  render on slow networks).
- Late discovery via CSS delays font loading → `preload` the primary font.
- Metric APIs (`size-adjust`, ascent/descent overrides) reduce swap CLS.
- Subsetting/woff2 shrinks payloads (smaller on throttled networks).

**Audit mapping:** `block-fonts`, `throttled-slow`, `throttled-2g`. The
`fonts` capture (status loaded/error/unloaded) + screenshot distinguish FOIT
(invisible text) from FOUT (visible fallback).
**Fix implications:** `font-display: swap` for text faces, `optional` for
decorative, preload + subset, metric-compatible fallback stacks.

## 4. Backgrounding, freeze, and discard — the lifecycle reality

- Hidden tabs are **frozen or discarded** by the browser (Chrome memory/energy
  saver modes increasingly do this). `unload`/`beforeunload` are unreliable —
  **`visibilitychange` is the practical session-end point**; persist + stop
  background work there.
- Page Lifecycle API: handle `freeze`/`resume`, check `document.wasDiscarded`
  after reload, rehydrate.
- Timers in background tabs are throttled/stopped — background work belongs in
  the service worker (e.g., background sync), not page timers.

**Audit mapping:** `backgrounded` (Page.setWebLifecycleState frozen), `tab-crash`.
**Fix implications:** persist on `visibilitychange`, resume on `resume`, handle
`wasDiscarded`, SW for background work.

## 5. Low-memory devices

- Low-end devices (the "next billion" market — much of Asia/Africa/LatAm) run
  low-RAM Android; pages are discarded under memory pressure, renderers crash,
  and the tab reloads cold.
- Heavy JS heaps + leaks amplify this: the audit's leak probe (heap/DOM-counter
  deltas across loops) finds the leak hygiene problems.

**Audit mapping:** `memory-critical` (Memory.simulatePressureNotification),
`tab-crash`, `cpu-6x`/`cpu-20x`, plus `harness/leak-probe.ts`.
**Fix implications:** reduce heap (code-splitting, content-visibility), fix
leaks, persist state before discard, handle reload recovery.

## 6. Network conditions & asset starvation

- Throttled networks (2G–slow-4G) starve assets: LCP-critical resources delayed,
  fonts swap late, images load progressively, first paint suffers.
- Priority matters: `fetchpriority` on LCP images, preload critical fonts,
  lazy-load below-fold, responsive images (srcset/sizes), modern codecs
  (avif/webp), brotli/gzip.

**Audit mapping:** `throttled-slow`, `throttled-2g`, `cpu-*`.
**Fix implications:** prioritize LCP, preload fonts, lazy media, compress.

## Implications for the guide library (GUIDES-GAP)

The research confirms + sharpens the 12 planned guides; the two highest-value
new ones are now written (lifecycle/backgrounding, crash-recovery). SW
adoption data (20%) + the China third-party-breakpoint pattern are the
strongest arguments for the offline/dns guides.

## Sources

- HTTP Archive Web Almanac 2025 (PWA chapter) — SW/manifest adoption
- web.dev articles: offline-cookbook, optimize-webfont-loading, font-best-practices
- developer.chrome.com: page-lifecycle-api, memory-and-energy-saver-mode
- W3C Service Workers spec (2025 CRD)
- ma.ttias.be website-uptime-statistics; Catchpoint Internet Resilience Report 2025
- Usenix Security '21 (Hoang et al.) — GFW measurement; GreatFire analyzer;
  chinawebfoundry GFW guide
