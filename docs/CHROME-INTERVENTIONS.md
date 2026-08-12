# Chrome Interventions: what the browser does to you + how to test + fix

Chrome ships automatic **interventions** — behaviors it applies to protect
users (battery, data, attention, privacy). They are load-bearing for resilience:
a site can work in DevTools and break under an intervention. This doc lists
them, how to simulate each in the audit harness, and how to mitigate.

## 1. Heavy Ad Intervention
- **What:** unloads ad iframes the user never interacted with, past thresholds:
  - > **4 MB** network usage (all descendant frames count)
  - > **15 s** main-thread time in a **30 s** window
  - > **60 s** total main-thread time
- **Signals:** "Ad removed" placeholder; Reporting API/DevTools diagnostics.
- **Audit:** `cpu-6x`/`cpu-20x` (main-thread pressure) + `throttled-2g` (network
  budget) on pages with ad/embed frames; watch for removed ad frames in the
  DOM/text + the console.
- **Mitigation:** stay under the budgets (lazy ads, no infinite loops in ad
  frames, cap third-party network), ad `loading=lazy`, no hidden heavy iframes.

## 2. Slow-network / abandoned-frames intervention
- **What:** on slow connections Chrome can stop loading **cross-site,
  parser-blocking scripts injected via `document.write()`** (2G, cache miss);
  hidden/offscreen frames are also deprioritized/abandoned.
- **Audit:** `throttled-2g` + a page using `document.write` or hidden iframes;
  watch for blocked scripts + unrendered frames.
- **Mitigation:** never `document.write` external scripts; use proper
  `<script src>` / modules; lazy-hidden frames; keep content visible.

## 3. Storage partitioning (privacy sandbox)
- **What:** third-party storage (cookies, localStorage, IndexedDB, SW caches)
  is partitioned by top-level site; service workers are partitioned.
- **Audit:** `incognito` (a fresh incognito browser context — partitioned,
  non-persistent) + `storage-cleared`.
- **Mitigation:** first-party storage only; don't assume cross-site state;
  handle `quota` + `SecurityError` on storage writes.

## 4. Notification abuse / quiet prompts
- **What:** permission prompts for notifications are quieter or auto-denied
  after abuse; permission revocation is enforced.
- **Audit:** `notifications` via `permissions-denied` + the permissions-state
  capture (report shows what the page thinks it has).
- **Mitigation:** request after engagement with context; handle denial state.

## 5. Autoplay policy
- **What:** audible autoplay requires user engagement; muted autoplay allowed.
- **Audit:** launch with `--autoplay-policy=no-user-gesture-required` to
  simulate the strict path (harness launch supports extra args).
- **Mitigation:** never rely on audible autoplay; `muted` + play-on-interaction.

## 6. Intrusive-ads / abusive-experiences interventions
- **What:** full-screen interstitials, unexpected navigation are blocked.
- **Audit:** interaction-plan level (assert no forced navigations).
- **Mitigation:** no full-screen interstitials; user-gesture-only navigation.

## 7. Memory & energy interventions (freeze/discard)
- **What:** hidden tabs frozen/discarded (see ECOSYSTEM-RESEARCH lifecycle).
- **Audit:** `backgrounded`, `tab-crash`, `memory-critical`.
- **Mitigation:** persist on `visibilitychange`, recover on reload.

## How the harness simulates each
| Intervention | Simulation |
|---|---|
| Heavy ad | cpu-6x/20x + throttled-2g; observe ad-frame removal |
| Slow network (doc.write) | throttled-2g + a doc.write-using fixture |
| Storage partitioning | incognito (real incognito browser context) |
| Notification abuse | permissions-denied + state capture |
| Autoplay | launch flag --autoplay-policy (documented) |
| Intrusive ads | interaction plans (assert no forced nav) |
| Freeze/discard | backgrounded / tab-crash / memory-critical |
