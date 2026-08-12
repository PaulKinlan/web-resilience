# Resilience Test Matrix

Every test the audit harness runs, what it does, what it captures, and what a
pass/fail looks like. Reviewed 2026-08-12 — this is the ground truth of the
audit's coverage.

## How a scenario works

1. Launch headless Chrome (raw CDP, no deps).
2. Create a fresh page target (state never leaks between scenarios).
3. Apply the scenario's CDP injection (emulation/interception) BEFORE navigation.
4. Navigate to the target URL.
5. Capture for ~2s after load: `Network.loadingFailed` events, console errors,
   uncaught exceptions, perf metrics, font face statuses, page-text sample,
   screenshot.
6. Emit a `ScenarioReport` into `audit.json`.

Scenarios run with `--all` or individually with `--scenario <id>`.

## The matrix

| # | Scenario | CDP injection | What it simulates | Key captured signals | Typical finding if broken |
|---|---|---|---|---|---|
| 1 | `baseline` | none (conditions reset) | The control run | all | (control) |
| 2 | `offline` | `Network.emulateNetworkConditions {offline:true}` | Fully offline network | nav result, `ERR_INTERNET_DISCONNECTED`, page text | browser error page, no SW shell, uncaught errors |
| 3 | `dns-fail` | `Fetch.enable` + `Fetch.failRequest` → `NameNotResolved` on every request | DNS interception / poisoned DNS (Great Firewall, captive portals) | `ERR_NAME_NOT_RESOLVED` per request | nothing loads; no cached/fallback path |
| 4 | `block-js` | `Network.setBlockedURLs ["*.js"]` | Main scripts blocked/censored/CDN down | console errors, "app loaded" marker absence, dead UI | app dead (no progressive enhancement) |
| 5 | `block-css` | `Network.setBlockedURLs ["*.css"]` | Stylesheets fail | layout text still readable? | content unusable/unstyled without CSS |
| 6 | `block-fonts` | `Network.setBlockedURLs ["*.woff2","*.woff","*.ttf","*.otf"]` | Font CDN blocked/slow | font `status:error`, FOIT/FOUT | invisible text (font-display:block), layout shift |
| 7 | `throttled-slow` | `emulateNetworkConditions {latency:400, download:200KB/s}` | Slow 4G (~1.6 Mbps) | asset starvation, LCP delay, font swap timing | slow LCP, starved assets, late font swap |
| 8 | `throttled-2g` | `{latency:1500, download:30KB/s}` | 2G | same, extreme | page effectively unusable, timeout risk |
| 9 | `cpu-6x` | `Emulation.setCPUThrottlingRate {rate:6}` | Low-end phone CPU | long tasks, INP risk | jank, unresponsive interactions |
| 10 | `cpu-20x` | `setCPUThrottlingRate {rate:20}` | Extreme low-end | same, worse | interaction death |
| 11 | `memory-critical` | `Memory.simulatePressureNotification {level:"critical"}` | Low-memory device pressure | crash/discard behavior, tab reload | page discarded, state lost |
| 12 | `tab-crash` | `Page.crash` + reload | Renderer crash (memory OOM) | crashDetected, state after reload | state lost on reload, no recovery |
| 13 | `backgrounded` | `Page.setWebLifecycleState {state:"frozen"}` → active | OS aggressively backgrounds the tab | timers/persistence after freeze | timers misbehave, state not persisted |
| 14 | `no-cache` | `Network.setCacheDisabled` | Cold start, no HTTP/SW cache | true first-load cost, all subresources refetched | no caching strategy → expensive every visit |
| 15 | `storage-quota` | `Storage.overrideQuotaForOrigin {quotaSize:0}` | Quota exhausted (low-memory/legacy device) | IndexedDB/localStorage write errors | persistence throws, app breaks |
| 16 | `hardware-concurrency` | `Emulation.setHardwareConcurrencyOverride {1}` | Single-core device | worker/pool behavior | assumes N cores, spawns too many workers, jank |
| 17 | `mobile` | UA override (Android) + touch + 360×800@2.5x viewport | Low-end phone | touch targets, viewport, mobile UA paths | desktop-only assumptions, tap-target misses |
| 18 | `geolocation-denied` | `Browser.setPermission {geolocation:denied}` | Permission denied | feature availability | app breaks instead of degrading |
| 19 | `permissions-denied` | `Browser.grantPermissions {state:denied}` (geo/notifications/camera/mic) | All sensitive permissions denied | feature availability | app breaks, no fallback UX |
| 20 | `cert-error` | `Security.setIgnoreCertificateErrors {ignore:true}` | Bad/expired HTTPS cert | secure-connection failures | page unusable, no error path |
| 21 | `data-saver` | `Emulation.setDataSaverOverride {saveData:true}` | Reduced-data mode | heavy media behavior | loads huge media regardless |
| 22 | `cookies-blocked` | `Emulation.setDocumentCookieDisabled {disabled:true}` | Cookies disabled | session/auth behavior | auth-dependent features break |
| 23 | `vision-deficiency` | `Emulation.setEmulatedVisionDeficiency {blurredVision}` | Low-vision user | a11y of contrast/blur-dependent UI | content unreadable |
| 24 | `reduced-motion` | `Emulation.setEmulatedMedia {prefers-reduced-motion:reduce}` | Motion-sensitivity user | animation behavior | animations play anyway |
| 25 | `sw-bypass` | `Network.setBypassServiceWorker {bypass:true}` | No-SW path (first visit, unsupported browser) | cache/offline behavior | relies on SW for critical loading |
| 26 | `storage-cleared` | `Storage.clearDataForOrigin {all}` | Storage wiped mid-session | rebuild-from-scratch behavior | app errors on missing state |
| 27 | `virtual-time` | `Emulation.setVirtualTimePolicy {budget}` | Long session fast-forward | timers/state across hours | state drift, timer storms |
| 28 | `runaway-script` | `Runtime.terminateExecution` | Infinite loop killed | post-kill recovery | frozen app, no recovery |
| 29 | `locale-rtl` | `Emulation.setLocaleOverride {ar}` | RTL locale | layout/i18n | broken RTL layout |

## Domain coverage (why 16 → 29, and what's left)

The 57 CDP domains are the FULL browser surface; scenarios are the
FAILURE-INJECTION subset. Current coverage by domain: Network (8 scenarios),
Fetch (1), Emulation (14), Memory (2), Page (2), Browser (2), Storage (2),
Security (1), Runtime (1), Target (1 — crash detection). Domains NOT used as
failure injections are inspection/hardware, not failure states (DOM, CSS,
Overlay, Accessibility, LayerTree, Media, WebAudio, WebAuthn, SmartCard,
Bluetooth, DeviceOrientation, Tethering, Cast, Extensions, PWA, Preload,
IndexedDB, CacheStorage, DOMStorage, FileSystem, Autofill, Input, IO,
HeadlessExperimental, PerformanceTimeline, Profiler, HeapProfiler, Debugger,
Console, Schema, Ads, Animation, Audits, BackgroundService, CrashReportContext,
EventBreakpoints, FedCm, DeviceAccess, Log, SystemInfo, Tracing, WebMCP).

## Interaction plans (extended coverage)

Loading alone misses interaction-dependent failures. The harness drives
interaction steps (click/type/submit/navigate/assert) — DOM-derived (forms,
buttons, links) or user-described:

- `harness/interactions.ts` — step model + DOM-flow derivation + recorder-macro mapping
- `harness/leak-probe.ts` — heap + DOM-counter deltas across repeated interaction loops

## Leak detection

`harness/leak-probe.ts <url> --loops 10`: samples `Memory.getDOMCounters`
(nodes, jsEventListeners — needs `--enable-leak-detection`) + `Runtime.getHeapUsage`
(works headless) before/after loops. Growing heap/node/listener count = leak.

## Evaluation mapping

- Rubrics: `eval/rubrics/*.json` (independent ground truth; the skills never see them).
- Scorer: `eval/score.ts` — precision/recall per finding class; `expected:true`
  = audit should find it, `expected:false` = audit should NOT find it;
  `notPresent` = the finding is the ABSENCE of the signal.
- Runner: `eval/run-eval.ts` (includes a SW prime pass so offline/dns scenarios
  exercise installed service workers).

## Verification of the harness itself

- Verified against live sites: `dns-fail` captures `net::ERR_NAME_NOT_RESOLVED`.
- Fixtures: `fixtures/resilient-club` (3 seeded issues) scores 4/5 with the
  issues detected; `fixtures/reference` (fixed) scores 3/5 with the fixes
  detected — the delta is measurable.

## Running it

```bash
deno run -A harness/run-scenario.ts <url> --all --screenshot --out /tmp/audit
deno run -A eval/run-eval.ts <url> eval/rubrics/<fixture>.json
deno run -A harness/leak-probe.ts <url> --loops 10
deno run -A fixtures/serve.ts 8080   # serve the fixtures locally
```
