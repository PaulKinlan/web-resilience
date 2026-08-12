# Research Round 2: challenges beyond the articulated set + architectural patterns

Deep research (2026-08-12, phase 2 of the multi-phase process) on resilience
challenges Paul did NOT pre-articulate, plus the architectural patterns the
industry uses to solve them. Each challenge maps to audit coverage (existing or
proposed).

## Part A — Challenges beyond the articulated set

### A1. Third-party / tag-manager single points of failure
- Real outages: Adobe Experience Cloud/Tag Manager incidents → 503s, timeouts,
  pages stalling until third-party requests time out. Tag incidents trace to:
  tag-manager config changes, site deploys, vendor outages, consent-manager
  misclassification, ad-blocker/browser rollout changes.
- Render-blocking third parties are the worst: they stall first paint.
- **Audit:** `block-third-party` (new scenario — blocks the common
  analytics/TMS/CDN/embed hosts), `block-js`.
- **Fix:** audit + remove render-blocking third parties, self-host critical
  scripts, `async`/`defer`/`type=module` everything else, monitor + runbooks.

### A2. Service worker operational failure modes (not just "no SW")
- Stale caches (unversioned assets in cache-first → stale reads), over-precaching
  (hurts performance), waiting-worker confusion (old tabs run old workers),
  version skew, cache poisoning.
- Lifecycle discipline: versioned cache keys + delete old caches in `activate`;
  keep the SW URL stable; `skipWaiting` + `clients.claim` only when the
  migration model allows.
- **Audit:** `sw-bypass` (the no-SW path), `offline`/`dns-fail` (shell freshness),
  `no-cache`. A "stale-SW" scenario is future work (needs two-version fixtures).
- **Fix:** workbox-style versioning, stale-while-revalidate for dynamic assets.

### A3. SPA deep-link / refresh 404s
- Direct refresh or deep-link on a non-root route 404s unless the server rewrites
  to the shell (nginx `try_files`, `connect-history-api-fallback`, platform
  rewrites). Platform-specific config bugs are common even when it "looks right".
- **Audit:** `baseline` navigation to a deep route (add a `deep-link` step to
  interaction plans).
- **Fix:** server rewrites + 200 fallback; on the client, a 404-aware catch-all
  route.

### A4. SSR hydration mismatches
- Server and client first render diverge: browser-only values (Date, random,
  window/navigator), locale/timezone variance, auth/feature-flag divergence,
  invalid HTML, third-party scripts touching the DOM.
- **Audit:** needs a fixture with SSR; capture console mismatch warnings under
  `baseline` + `throttled-*`. Future work (fixture + signal).
- **Fix:** deterministic renders (no Date/random in render), Suspense isolation,
  production-mode testing, recoverable-error logging.

### A5. CSP misconfiguration breaking features
- Too-strict CSP breaks analytics/embeds/fonts/chat/tag managers; inline
  script/style blocking; missing `data:`/`connect-src` for websockets/chat;
  `frame-src` for payments/maps. Mixed-content blocking increasingly enforced.
- **Audit:** `cert-error` (TLS surface) + a future `csp-report-only` fixture.
- **Fix:** start Report-Only, observe violations, tighten gradually.

### A6. Ad-blocker breakage
- SINBAD research: dynamic + content-rule breakage is common + hard to detect
  (~20% accuracy gain vs prior art); remediation is nontrivial. Users DO hit
  broken layouts from blockers.
- **Audit:** `block-third-party` approximates the pattern-blocking effect.
- **Fix:** resilient layout (content usable without the blocked assets),
  defensive positioning (no absolute-positioned critical content).

### A7. Realtime transport failure (WebSocket/SSE)
- WebSocket reconnect is NOT automatic: needs exponential backoff + jitter,
  bounded retries, explicit resubscribe/session resume (sessionId + last
  sequence). Missed events during downtime are the silent killer.
- SSE is a strong fallback (built-in reconnect + Last-Event-ID replay).
- **Audit:** `websocket-drop` (new scenario — blocks ws://wss://).
- **Fix:** reconnection manager with backoff + resubscribe, SSE fallback,
  idempotent event processing.

### A8. Checkout / payment uncertainty
- The worst failure is an UNKNOWN outcome: treat checkout as orchestration with
  explicit pending/processing/uncertain states; idempotency-first writes;
  correlation IDs; retry only transient + safe; reconciliation/background jobs.
- **Audit:** interaction-plan level (drive a checkout flow under `offline`,
  `throttled-2g`, `dns-fail`; assert the UI shows pending/retry, not a crash).
- **Fix:** idempotency keys, state machines, pending-state UX, reconciliation.

### A9. Session/token expiry mid-flow
- Token expiry drops in-progress work; the pattern: intercept 401/expiry →
  re-auth → retry the original request; preserve drafts (activity-based refresh,
  draft persistence); guard against refresh loops.
- **Audit:** interaction-plan level (fixture with a short-lived session).
- **Fix:** auth interceptor + retry, draft persistence on `visibilitychange`.

### A10. Microfrontends / Module Federation failures
- A failed remote can break BEFORE React mounts — recovery belongs in the
  loader/bootstrap path, not only error boundaries. Stale `remoteEntry.js`,
  failed manifest fetches, shared-dependency mismatches.
- Hardening: retry/backoff + cache-busting on remote loads, deterministic
  fallback, bounded termination, short/no-cache for remoteEntry + immutable
  hashed chunks.
- **Audit:** `block-js` (a remote chunk fails) + interaction plans.
- **Fix:** loader-path error handling, federation fallbacks, telemetry.

### A11. Optimistic UI divergence
- Optimistic updates must reconcile with server truth: explicit pending/
  confirmed states or an operation queue, idempotency keys, version checks
  (ETag/If-Match), rollback/rebase from authoritative state on failure.
- **Audit:** interaction-plan level (double-submit + retry flows under
  throttled/offline).
- **Fix:** pending-state model, idempotent mutations, server-truth rebase.

### A12. Cache strategy traps
- Unversioned assets under cache-first → stale reads; over-precaching hurts
  performance; cache poisoning from shared caches.
- **Audit:** `no-cache` (cold), `offline` (freshness), `sw-bypass`.
- **Fix:** versioned/hashed asset URLs, immutable long-cache, SWR for dynamic.

### A13. Browser version skew (Baseline)
- Safari-vs-Chrome divergence; decide with Baseline (Newly/Widely) + real-user
  data; prefer Widely-available defaults; polyfill only critical features.
- **Audit:** future — run the matrix under a Safari-like UA/engine flag
  (Emulation.setUserAgentOverride is only cosmetic; real engine testing needs
  WebKit — documented as a limitation).

### A14. Local-first / offline-first architecture
- CRDT-based local-first (Automerge, Replicache) keeps apps usable offline +
  merges concurrent edits; still maturing (large-history/conflict performance).
- **Audit:** `offline` (data usable), `storage-cleared`, `storage-quota`.
- **Fix:** local-first data layer with sync + conflict resolution.

## Part B — Architectural patterns (the catalog)

1. **SW strategy matrix** — cache-first (static shell), network-first (navigations),
   stale-while-revalidate (dynamic), generic fallbacks; versioned caches.
2. **Edge/CDN resilience** — multi-CDN, origin failover, edge functions with
   geographic fallback, disciplined invalidation.
3. **Containment + circuit breakers** — per-feature boundaries, error
   classification (transient vs permanent), circuit breakers + bulkheads so one
   failure doesn't cascade.
4. **Retry discipline** — transient + idempotent ONLY, exponential backoff +
   jitter, caps/budgets, no retry storms.
5. **BFF with fallbacks** — backend-for-frontend shields the client from
   backend shape churn; fallback data paths.
6. **Streaming SSR + islands** — HTML arrives early (streaming), only what's
   interactive hydrates (islands/partial hydration); decouples time-to-content
   from time-to-interactive.
7. **Data-fetching resilience** — SWR/React Query-style: cache, background
   refetch, retry, dedupe, stale-while-revalidate at the data layer.
8. **Idempotency + correlation IDs** — for every write path.
9. **Session recovery UX** — preserve in-progress work, re-auth + retry,
   draft persistence.
10. **Fallback hierarchies (progressive enhancement 2.0)** — content → styled →
    enhanced → realtime; each layer independent.
11. **Feature flags / kill switches** — disable a broken feature without a deploy.
12. **SPA shell + route splitting + preloading** — small initial JS, prefetch on
    intent.
13. **Local-first (CRDTs)** — offline data + sync.

## Part C — Research implications for the audit matrix

New scenarios added from this round: `block-third-party` (A1/A6), `websocket-drop`
(A7). Proposed future coverage: `deep-link` interaction step (A3), hydration
mismatch capture (A4), stale-SW two-version fixture (A2), CSP Report-Only
fixture (A5), checkout/session/optimistic flows in interaction plans (A8/A9/A11).
Real-engine testing (Safari) is a documented limitation of the CDP-only harness
(A13).

## Sources
- web.dev: tag-best-practices, service-worker-lifecycle, baseline-and-polyfills
- Catchpoint: Adobe Experience Cloud outage impact; Fastly: resilience in the age
  of third-party dependencies; paulcalvano.com third-parties + SPOF
- Chrome Workbox: service-worker deployment; web.dev offline cookbook
- React docs (hydration error 418); LogRocket RSC hydration mismatches
- connect-history-api-fallback; oliverjam.es avoid SPA 404
- MDN CSP; sitegrade.io configure CSP without breaking
- arXiv 2410.23504 (SINBAD ad-block breakage); inkandswitch.com local-first essay
- websocket.org reconnection + best practices; getstream.io websocket vs SSE
- Shopify engineering resilient payment systems; commercetools checkout flow
- stevekinney.com error boundaries and federation; federation-resilience (GitHub)
- matheuspalma.com optimistic UI reconciliation
- mateu.io session-expiry UX; Salesforce PWA kit sessions
