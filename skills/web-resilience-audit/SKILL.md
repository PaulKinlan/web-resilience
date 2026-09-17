---
name: web-resilience-audit
description: >-
  Audit a website against a matrix of 46 failure states — offline, DNS
  interception, blocked JS/CSS/fonts/images, network and CPU throttling, low
  memory, tab crash, backgrounding, permission denial, storage quota, incognito
  — using raw Chrome DevTools Protocol, and produce a structured findings
  report. Use when the user asks to check a site's resilience, failure
  handling, offline behavior, low-end-device behavior, what happens when
  something breaks, or wants a resilience test plan for a URL. Pairs with
  web-resilience-fix, which remediates what this finds.
---

# Web Resilience Audit

Audit a website against a matrix of failure states (offline, DNS interception,
asset loss, throttling, CPU/memory pressure, backgrounding) using raw Chrome
DevTools Protocol, and produce a structured findings report. The companion
skill (web-resilience-fix) maps findings to remediation patterns.

## When to use

- The user asks to check a site's resilience, failure handling, offline behavior,
  low-end-device behavior, or "what happens when X breaks".
- The user wants a resilience test plan for a URL (interaction paths included).
- You are evaluating a fixture site against a rubric (run via the eval harness).

## Running the harness

Everything goes through the `wr` launcher, which resolves Deno and Chrome for
you (including Chrome for Testing on machines where managed Chrome refuses
remote debugging):

```bash
WR="${WEB_RESILIENCE_HOME:-$HOME/.gemini/config/plugins/web-resilience-plugin}/bin/wr"
```

If a command fails with a missing binary, run `$WR doctor` first and report
what it says — it distinguishes "not installed" from "policy blocked".

## How it works

1. **Run the scenario matrix** (all scenarios, or the ones the user asks for):

```bash
# single scenario (or a comma-separated list)
$WR audit <url> --scenario offline --screenshot --out /tmp/audit-<site>
# full matrix (recommended first pass)
$WR audit <url> --all --screenshot --out /tmp/audit-<site>
# add --prime to warm the origin first, so a service worker installs before
# the offline/dns scenarios run (otherwise a site WITH a shell looks like one
# without)
$WR audit <url> --all --prime --out /tmp/audit-<site>
# list the matrix
$WR scenarios
```


2. **Read `/tmp/audit-<site>/audit.json`** — one `ScenarioReport` per scenario:
   - `networkFailures` — every `Network.loadingFailed`, with `url` and
     `resourceType` resolved from the matching request, plus `errorText`,
     `canceled`, `blockedReason`. Name the specific asset in your finding.
   - `consoleErrors` / `uncaughtExceptions` — JS failures under the injected condition
   - `browserLogs` — diagnostics the BROWSER emits, not the page. CSP
     violations, CORS rejections, mixed content, deprecations and
     interventions appear **only** here. A report-only CSP that would break the
     page once enforced is invisible everywhere else, so check this even when
     `consoleErrors` is empty.
   - `perf` — `metrics` (full Performance.getMetrics set) + `nav` (fcp/dcl/load)
   - `fonts` — font faces + their status (loaded/error/unloaded)
   - `pageTextSample` — body text (lets text-only models analyze without vision)
   - `screenshotPath` — PNG per scenario (attach to context when vision-capable)
   - `navSucceeded`, `crashDetected`
   - `extra.permissions` — what the page believes it has been granted
   - `harnessError` — **the scenario never ran.** The browser died or CDP
     failed. Every other field is empty because nothing was measured, not
     because the site coped. Report it as a gap and re-run that scenario.
   - `extra.injectionErrors` — **check this first.** If non-empty, the scenario's
     CDP setup failed and the run does not test what it claims to; report it
     rather than reading the result as a pass.
   - `extra.interactions` — per-step results when an interaction plan was used

3. **Analyze per scenario** and answer these questions:
   - **offline / dns-fail**: Does anything survive? Is there a service worker /
     app-shell fallback / cached shell? Or a blank page + uncaught errors?
   - **block-js / block-css**: Does the page degrade gracefully (content visible,
     no dead UI) or go blank/white? Progressive enhancement present?
   - **block-fonts**: FOIT vs FOUT? Does the fallback stack render? (`fonts`
     status shows `error`; compare the screenshot)
   - **throttled-***: Which assets starve? Font swap behavior? LCP affected?
   - **cpu-***: Long tasks / INP risk (from perf metrics + the report).
   - **memory-critical / tab-crash**: State preserved on reload? Crash recovery?
   - **backgrounded**: Timers/persistence survive freeze/resume?
   - **no-cache**: True first-load cost; is caching configured?
   - **storage-quota**: Persistence writes fail gracefully or throw?
   - **hardware-concurrency**: Worker/pool code assumes more cores than 1?

4. **Emit the findings report** as a structured list — one finding per failure
   class, each with: scenario, observed signal (quote the error text/status),
   severity (critical/major/minor/info), and the affected resource.

## Interaction coverage (test plans)

Loading alone misses interaction-dependent failures. Give the harness a flow and
it drives it **inside every scenario**, one step at a time:

```bash
# A flow you wrote, or a DevTools Recorder export — both work unmodified
$WR audit <url> --all --plan /tmp/checkout-flow.json

# No flow available: survey the DOM on a clean load and synthesise one
$WR audit <url> --all --derive-plan

$WR leak <url> --loops 10 --steps /tmp/checkout-flow.json
```

Plan format (`{ name, steps[] }`), one step per object:

| `kind` | fields | notes |
|---|---|---|
| `click` / `hover` | `selector` | real mouse events at the element's box |
| `type` | `selector`, `value` | |
| `press` | `key` | `Enter`, `Tab`, `Escape`, arrows |
| `submit` | `selector` | |
| `navigate` | `url` | |
| `wait` | `ms` | |
| `wait-for` | `selector`, `ms` | |
| `scroll` | `selector` | |
| `assert-text` | `selector`, `text` | substring match |

Any step may carry `optional: true` (record the failure, keep going) and a
`label` (what appears in the report). Selectors are CSS, `text=Buy now`, or
`aria/Buy now`.

> [!IMPORTANT]
> Bookend every flow with `assert-text`. Clicks dispatch real input events, so
> an overlay or a zero-size button does fail — but a button whose **handler
> never bound** (blocked JS, offline, a dead bundle) clicks perfectly happily
> and records as a pass. The assertion is what turns that into a finding.

Results land in `extra.interactions`: per-step `ok`/`error`/`durationMs`, the
index of the step that broke the flow (`failedAt`), and the network failures and
console errors attributed to **each individual step** — so the report says
"clicking Checkout killed 3 requests", not merely "the flow failed".

Compare `failedAt` across scenarios. A flow that completes on `baseline` and
breaks at step 0 under `block-js` has located a single point of failure.

### Choosing the flows to test

- Ask the user which flows matter ("sign in, add to cart, checkout, offline
  payment retry"). This beats every automatic method.
- Reuse a recorded macro if one exists: DevTools → Recorder → export JSON.
- `--derive-plan` is the floor, not a substitute — it finds the primary button
  and the first form, not your checkout. Use it when you have nothing else.

Worked examples, including one that isolates a fixture's seeded
single-point-of-failure: `fixtures/plans/README.md`.

## Leak detection (optional deep-dive, not a matrix scenario)

`$WR leak <url> --loops 10` samples heap + DOM-counter deltas across repeated
interaction loops — a growing heap/node/listener count is a leak to flag in the
findings (see web-resilience-fix). If the flow itself never ran, the verdict is
`INCONCLUSIVE`, not "no growth".


## Source-aware audit (optional)

When the user has the site's source, read it yourself (there is no `--source`
flag on the harness — the analysis is yours, not the runner's): derive user
flows + expectations from the code (routes, forms, error paths, feature flags),
then encode them as an interaction plan and pass it via `--plan`.
The audit skill uses source to DESIGN tests; the fix skill uses source to
APPLY them — the find/fix delineation is preserved (both may read the source,
but the audit still only REPORTS, the fix only CHANGES).


## Vision guidance

Screenshots are captured for every scenario. **Attach them to your context
only if your model's provider is vision-capable** (Claude, GPT-4o/5, Gemini).
For text-only providers (DeepSeek, GLM), rely on the structured signals
(network failures, console errors, font status, page text, perf) — they are
sufficient for the findings classes above.

To analyse screenshots out-of-band (or to get a second opinion on "is this page
actually blank"), run `$WR vision <audit-dir>`. It annotates each scenario with
`extra.vision` — a verdict of `usable`/`degraded`/`broken` plus observations —
using Gemini. It needs `GEMINI_API_KEY`; without one it records the reason and
changes nothing else, so it is always safe to attempt.


## Rules

- Never modify the target site — the audit is read-only (CDP emulation +
  interception only).
- A scenario that "completes" despite the injection (e.g., offline nav still
  succeeds) is itself a finding (cached shell / SW) — record it, don't dismiss it.
- If a scenario run errors (injection failed, navigation timed out), record the
  error in the finding — do not silently skip.
