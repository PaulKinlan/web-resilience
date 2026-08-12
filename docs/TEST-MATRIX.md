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
