# Guide: JS Resilience (progressive enhancement + defensive init)

**Failure class:** `js-failure`
**Audit scenario:** `block-js`, `offline`, `dns-fail`
**Symptom the audit catches:** under `block-js` the "app loaded" marker is
absent AND core UI is dead (no content fallback, button does nothing, page
looks broken); console errors under any failure scenario.

## Root cause
The whole app depends on one bundle that owns ALL interactivity + rendering —
when it fails to load (blocked, offline, DNS fail), nothing works. Top-level
throws kill the entire init chain (one bad feature = everything dead).

## Canonical pattern
1. **Content first, JS enhances:** semantic HTML renders without JS
   (`<noscript>` fallbacks where needed); JS adds behavior, never requirements.
2. **Defensive init:** feature-detect before use; wrap independent features in
   their own try/catch; no single top-level throw that kills the chain.
3. **Error surfaces:** network calls must fail gracefully (catch + user message)
   — never an unhandled rejection.
4. **`online`/`offline` events** to update the UI when connectivity changes.
5. Optional: module-level code-splitting so one bad chunk doesn't take the app.

## Before / after
- `fixtures/resilient-club` — one bundle that throws at the top level: blocked
  JS = dead button + no status.
- `fixtures/reference` — feature-detected enhancement + `online`/`offline`
  handling + noscript fallback.

## Re-verify
```bash
deno run -A harness/run-scenario.ts <url> --scenario block-js --screenshot
# pass: core content visible + usable; the only console errors are the blocked
# script load itself, not app crashes.
```
