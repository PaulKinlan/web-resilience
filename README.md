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

Full CDP capability analysis: docs/CDP-CAPABILITIES.md. Vision routing:
docs/VISION.md. Guide gaps to author: docs/GUIDES-GAP.md.

## Quick start

```bash
# Audit a site through every failure scenario (screenshots included)
deno run -A harness/run-scenario.ts https://your.site/ --all --screenshot --out /tmp/audit-your-site

# Single scenario
deno run -A harness/run-scenario.ts https://your.site/ --scenario offline --screenshot

# Run the eval against a fixture + rubric
deno run -A eval/run-eval.ts http://127.0.0.1:8080/resilient-club/ eval/rubrics/resilient-club.json

# Serve the fixtures locally
deno run -A fixtures/serve.ts 8080
```

## Running in an agent session (pi / Claude Code / Codex)

- In-session: invoke the skills normally (they shell out to the harness). The
  user's existing tokens + installed skills apply; no API keys required.
- Screenshots: attach to the model when the provider is vision-capable (Claude,
  GPT-4o/5, Gemini); text-only providers (DeepSeek, GLM) rely on the structured
  signals, which fully cover the current finding classes.

## Status

- [x] Scaffold + harness (launch/scenarios/capture/report) — verified against live sites
- [x] Audit + fix skills (drafts)
- [x] Eval scorer + runner (draft)
- [x] Fixture 1 (resilient-club, issue-seeded) + serve
- [ ] Reference site (fixed version of resilient-club)
- [ ] Rubric for fixture 1 + first eval run
- [ ] Vision provider adapter (Gemini first)
- [ ] Interaction test plans (DOM-derived + user-described + recorder macros)
- [ ] Leak-detection step in the audit
- [ ] Guide authoring per GUIDES-GAP.md
- [ ] Autoresearch loop wiring
