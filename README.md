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

# Autoresearch: propose a change, measure it, keep it only if it wins
./bin/wr autoresearch --objective harness --rounds 5 \
  --mutator ./eval/mutators/agentapi-mutator.sh
```

`bin/wr` resolves Deno and Chrome for you — including Chrome for Testing on
machines where managed Chrome refuses remote debugging. `deno task` equivalents
exist for every command if you prefer.

## Autoresearch

A competitive loop: branch a worktree, let a mutator edit it, measure, keep the
winner only if it is *strictly* better. Two objectives, because the repo has
two different things worth improving and they are measured in different places:

| | `--objective harness` | `--objective skill` |
|---|---|---|
| Mutable | `harness/` | `skills/`, `guides/` |
| Measured by | scoring `audit.json` vs the rubric | scoring an **agent's findings report** |
| Needs `--agent-cmd` | no | yes |

> [!IMPORTANT]
> The harness objective is blind to prose. `SKILL.md` and the guides never
> touch an `audit.json`, so under `--objective harness` every skill variant
> scores identically and "keep the winner" degenerates into keeping the first.
> Use `--objective skill` for prose.

`eval/` and `fixtures/` are frozen ground truth. A round that changes them is
discarded **without being scored** — a loop that can edit its own rubric
optimises the ruler. To confirm the guard is live:

```bash
./bin/wr autoresearch --rounds 1 --mutator ./eval/mutators/cheat.sh
# must report ISOLATION VIOLATION and score nothing
```

Nothing is applied to your working tree; the winner is parked on
`refs/autoresearch/champion` for review. Contracts, and the limits worth
knowing (measurement noise, fixture overfitting): eval/mutators/README.md.

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
- [x] Autoresearch mutation loop: worktree isolation, pluggable objective (`harness` scores audit.json, `skill` scores an agent's findings report), enforced frozen ground truth, keep-the-winner on a git ref (eval/mutators/README.md)
- [x] First unit tests (21) — isolation guard + findings scorer, gated in CI
- [x] Six fixtures + rubrics — resilient-club, reference, spa-hydration, sw-dependency, csp-report-only, third-party (fixtures/README.md); five gated in CI
- [x] Browser diagnostics captured (`browserLogs`) — CSP/CORS/mixed-content/deprecations were enabled but never subscribed, so they reached no report
- [x] Matrix-completeness gate — a run that scored 5/5 with 24 of 46 scenarios missing is now a hard failure (`--max-unrun`, default 0); a crashed browser is relaunched and the lost scenario retried once
- [x] Scenario load phases (`before-load` / `after-load`) — `tab-crash` was crashing `about:blank` and then loading the site cleanly, so it tested nothing; it now crashes the running app and measures recovery
- [x] Crash detection fixed — the harness watched browser-scoped `Target.targetCrashed` behind a session filter that could never match, so `crashDetected` was false on every run ever recorded
- [x] Evidence strength per finding (`strong` / `survives` / `hollow`) — a rubric entry whose signal is already true at baseline, in a scenario whose report is identical to baseline, scores a point while proving nothing. **6 of 30 entries were in that state**, 4 of them in the reference fixture. Reported in `score.json`, gateable with `--max-hollow`
- [ ] Rebuild the 6 hollow entries — `reference` offline/dns/fonts, `resilient-club` fonts, `sw-dependency` offline (needs fixtures that make the failure observable; the font fixtures point at `.invalid` hosts, so the font already fails at baseline and `block-fonts` cannot be distinguished)
- [x] Service-worker network shaping — page-session `Network.*` never reached the worker, so an "offline" run on a SW site was served live from the network. Worker targets are now enumerated and shaped, and released per scenario: leaving `Fetch.enable` on a worker wedges it for the browser's remaining life, which made `dns-fail` silently corrupt every scenario that ran after it
- [x] Inertness auditor (`wr inert`) — fingerprints every scenario against baseline and reports which are byte-identical to not running at all. **22 of 45 were**, on all six fixtures
- [x] Injection verification (`injection` in every report) — each scenario can carry a probe proving its failure was actually in force when the page was measured. Without it, a scenario that silently injects nothing produces a clean report, and a clean report scores as the site coping. `wr inert` now groups its findings by cause: harness bug / untriaged / injected-but-silent / fixture gap / not implementable
- [x] Four scenarios were provably doing nothing, each found by the probes rather than by reading the code:
  - `storage-quota` used `quotaSize: 0`, which CDP reads as *no override* — the "storage exhausted" scenario was granting the origin the full ~10GB default. Measured: 4MB written successfully
  - `cert-error` ran `Security.setIgnoreCertificateErrors{ignore:true}`, which makes Chrome **accept** bad certificates. It could not fail, and against a genuinely broken cert it would have hidden the problem. Now declared `unsupported` rather than quietly passing
  - `sw-stop` called `ServiceWorker.stopAllWorkers` without enabling the domain, failing with "ServiceWorker domain not enabled" on every run since it was written
  - `memory-critical` suppressed pressure notifications and then sent one; `backgrounded`, `runaway-script` and `storage-cleared` were applied to `about:blank` before the app existed. All four now run `after-load`
- [ ] `data-saver` is a known dead scenario — `Emulation.setDataSaverOverride` leaves `navigator.connection.saveData` false, and that flag is the only thing a page can observe. Left in, refuting, rather than deleted
- [ ] Fixture gaps blocking 7 scenarios — no fixture opens a WebSocket, plays media, has a file input, or serves a webfont from a host that resolves. Declared per-scenario in `requires` so they are not mistaken for harness bugs

