# Guide: Backgrounding & Page Lifecycle (freeze/resume/discard)

**Failure class:** `backgrounding`
**Audit scenario:** `backgrounded`
**Symptom the audit catches:** after `Page.setWebLifecycleState frozen` + resume,
timers misbehave, unsaved state is lost, background work restarts incorrectly.

## Root cause
Pages assume they can run timers/network in the background and persist at
`unload`/`beforeunload` — both unreliable. Browsers freeze/discard hidden tabs
(Chrome memory + energy saver modes increasingly do this); the research shows
`visibilitychange` is the practical session-end point, and `freeze`/`resume` +
`document.wasDiscarded` are the real recovery signals.

## Canonical pattern
1. Persist unsaved state on `visibilitychange` (hidden → save), not `unload`.
2. Handle Page Lifecycle: `freeze`/`resume` events; after reload check
   `document.wasDiscarded` and rehydrate/restore the UI.
3. Move background work out of page timers into the service worker (background
   sync, push) — page timers are throttled/stopped when hidden.
4. On `resume`, re-sync (fetch the latest, refresh stale state).

## Before / after
- `fixtures/resilient-club` — no lifecycle handling; freeze loses status state.
- `fixtures/reference` — `visibilitychange`-based persistence + online/offline
  re-sync on resume.

## Re-verify
```bash
deno run -A harness/run-scenario.ts <url> --scenario backgrounded
# pass: state persisted across freeze/resume; no timer storm on resume
```
