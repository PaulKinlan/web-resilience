# Resilient Web — audit, fix, and an isolated eval

A skill pair that audits websites against a matrix of **failure states**
(offline, DNS interception, asset loss, throttling, low memory, backgrounding)
using raw Chrome DevTools Protocol, then fixes what it finds — plus an **eval
framework with competitive isolation** so the skills are validated against
independent ground truth, never against their own output.

## The two skills

- **skills/web-resilience-audit** — URL → scenario matrix via CDP → structured
  findings report (per-scenario: network failures, console errors, font status,
  perf, screenshots, page text).
- **skills/web-resilience-fix** — findings → remediation patterns (mapped to
  modern-web-guidance where it exists, authored guides where it doesn't) → apply
  fixes → re-run the audit → report the delta.

## The eval framework (competitive isolation)

- `eval/rubric.schema.json` — ground-truth rubrics written INDEPENDENTLY of the
  skills. The harness holds them; the skills never see them.
- `eval/score.ts` — precision/recall vs the rubric (per finding class).
- `eval/run-eval.ts` — fixture → audit → score → (fix → re-audit) → delta.
- Autoresearch loop (pi-autoresearch pattern): iterate the SKILLS against the
  eval — each round scores, improves, keeps the winner. It optimizes the skill,
  never the eval.

## The failure-state matrix

| Scenario | CDP injection |
|---|---|
| baseline | control |
| offline | Network.emulateNetworkConditions offline |
| dns-fail | Fetch.failRequest → NameNotResolved (GFW/DNS interception) |
| block-js / block-css / block-fonts | Network.setBlockedURLs |
| throttled-slow / throttled-2g | latency + throughput emulation |
| cpu-6x / cpu-20x | Emulation.setCPUThrottlingRate |
| memory-critical | Memory.simulatePressureNotification critical |
| tab-crash | Page.crash |
| backgrounded | Page.setWebLifecycleState frozen |
| no-cache | Network.setCacheDisabled |
| storage-quota | Storage.overrideQuotaForOrigin → 0 |
| hardware-concurrency | Emulation.setHardwareConcurrencyOverride → 1 |

Full CDP capability analysis: docs/CDP-CAPABILITIES.md. The complete test
matrix (what every scenario does + what pass/fail looks like): docs/TEST-MATRIX.md.
Chrome interventions (heavy ads, slow-network, partitioning — how to test + fix): docs/CHROME-INTERVENTIONS.md.
Ecosystem research grounding the matrix: docs/ECOSYSTEM-RESEARCH.md (round 1) + docs/RESEARCH-ROUND-2.md (challenges beyond the articulated set + architectural pattern catalog). Vision
routing: docs/VISION.md. Guide gaps to author: docs/GUIDES-GAP.md.

## Quick start

```bash
# Check this machine can run an audit (Deno, Chrome, a real CDP handshake)
./bin/wr doctor

# Audit a site through every failure scenario (screenshots included)
./bin/wr audit https://your.site/ --all --screenshot --out /tmp/audit-your-site

# Single scenario (or a comma-separated list); --prime installs the SW first
./bin/wr audit https://your.site/ --scenario offline,dns-fail --prime --screenshot

# Drive a user flow inside every scenario — loading a page tests only a
# fraction of a site. Accepts our format or a DevTools Recorder export.
./bin/wr audit https://your.site/ --all --plan fixtures/plans/resilient-club.plan.json

# No plan? Survey the DOM on a clean load and synthesise one
./bin/wr audit https://your.site/ --all --derive-plan

# Run the eval against a fixture + rubric
./bin/wr eval http://127.0.0.1:8080/resilient-club/ eval/rubrics/resilient-club.json

# Serve the fixtures locally
./bin/wr serve 8080

# Leak probe (heap/node/listener deltas across interaction loops)
./bin/wr leak http://127.0.0.1:8080/resilient-club/ --loops 10

# Autoresearch measurement loop
./bin/wr autoresearch --rounds 3
```

`bin/wr` resolves Deno and Chrome for you — including Chrome for Testing on
machines where managed Chrome refuses remote debugging. `deno task` equivalents
exist for every command if you prefer.

## Install

```bash
./antigravity/install.sh      # Antigravity / Jetski plugin (symlinked)
```

Both skills then become discoverable to the agent. Full instructions, including
the managed/corporate-machine path (`RemoteDebuggingAllowed` policy, Deno off
the non-interactive `PATH`, symlink restrictions): docs/INSTALL.md.

## Running in an agent session (Antigravity / pi / Claude Code / Codex)

- In-session: invoke the skills normally (they shell out to `bin/wr`). The
  user's existing tokens + installed skills apply; no API keys required.
- Screenshots: attach to the model when the provider is vision-capable (Claude,
  GPT-4o/5, Gemini); text-only providers (DeepSeek, GLM) rely on the structured
  signals, which fully cover the current finding classes.


## Status

- [x] Scaffold + harness (launch/scenarios/capture/report) — verified against live sites
- [x] Audit + fix skills
- [x] Eval scorer + runner — both fixtures score 5/5, precision 1.0, 0 false positives
- [x] Fixture 1 (resilient-club, issue-seeded) + reference site (SW shell, font swap, resilient init) + local server
- [x] Rubrics for both fixtures (v1/v2) + SW prime pass in the eval
- [x] Interaction plans (harness/interactions.ts — DOM-derived + user-described steps)
- [x] Leak probe (harness/leak-probe.ts — heap + DOM-counter deltas across loops)
- [x] All 22 guides written (docs/GUIDES-GAP.md — catalog complete)
- [x] Autoresearch scaffold (eval/autoresearch.ts — measurement loop; mutation step plugs into pi-autoresearch)
- [x] Packaging: `bin/wr` launcher, `antigravity/` plugin + installer, skill frontmatter, `wr doctor` (docs/INSTALL.md)
- [x] Harness hardening: cross-platform Chrome discovery (Chrome for Testing preferred), DevToolsActivePort startup, one shared scenario runner for the audit and the eval, strict `deno check`
- [x] Vision adapter (harness/vision.ts — Gemini, per-scenario prompts, structured verdicts; `wr vision <audit-dir>`) — live call not yet exercised against a real key
- [x] CI (deno check + lint, plus the eval gated on `--expect` so a scoring regression fails the build)
- [x] Interaction coverage: stepped execution with real CDP input events, DevTools Recorder import, `--derive-plan` DOM derivation, per-step network/console damage attribution (fixtures/plans/)
- [x] Harness fault tolerance: a dead CDP socket self-diagnoses, a failed scenario is reported as `harnessError` instead of aborting the matrix
- [ ] Autoresearch mutation loop (model-proposed skill/guide changes)
- [ ] More fixtures + rubrics (stale-SW, CSP report-only, SPA hydration, third-party dependency)

