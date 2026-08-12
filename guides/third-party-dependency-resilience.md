# Guide: Third-Party Dependency Resilience

**Failure class:** `js-failure` (third-party), asset starvation
**Audit scenarios:** `block-third-party`, `block-js`, `block-fonts`, `throttled-2g`
**Symptom:** the page stalls/dies when analytics/TMS/CDN/embed hosts fail (China,
tag-manager outages, ad blockers).

## Root cause
Render-blocking third parties + hard dependencies on external hosts. The
research: tag-manager incidents cause real outages; third-party Google/Facebook-
stack assets are the #1 breakpoint for China users even when the first-party
origin is healthy.

## Canonical pattern
1. **Make critical third-party first-party:** self-host what the core experience
   needs (fonts, analytics scripts, shared libraries) — first-party origin is
   the most reliable.
2. Never render-block on third parties: `async`/`defer`/`type=module`; load
   non-critical embeds lazily (on scroll/interaction).
3. Fallbacks: analytics failure must never block the app (wrap in try/catch,
   fire-and-forget); embeds get a placeholder/fallback UI.
4. `fetchpriority` + preload only first-party criticals.

## Re-verify
`deno run -A harness/run-scenario.ts <url> --scenario block-third-party --screenshot` — pass: page fully usable; only non-critical telemetry missing.
