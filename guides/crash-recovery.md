# Guide: Crash & Discard Recovery

**Failure class:** `memory`, `backgrounding`
**Audit scenario:** `tab-crash`, `memory-critical`
**Symptom the audit catches:** `crashDetected` under `tab-crash`; after the
reload, page state is lost (form inputs, scroll, app state) with no recovery UI.

## Root cause
Nothing persists critical state during the session, so a renderer crash, tab
discard (memory pressure), or OOM reload returns the user to a blank/fresh
page. Low-memory devices (the "next billion" market) discard tabs routinely.

## Canonical pattern
1. Persist critical state as it changes (sessionStorage/IndexedDB on change —
   not at `unload`).
2. After load, detect a recovery: `document.wasDiscarded` (lifecycle API) or a
   "restored" flag in storage → restore the UI + notify the user.
3. Keep the payload small (large state in storage can itself trigger pressure).
4. The SW shell (guide: offline-fallback) makes the reload cheap + instant.

## Re-verify
```bash
deno run -A harness/run-scenario.ts <url> --scenario tab-crash
# pass: after crash + reload, the app restores the prior state (or shows a
# clear recovery message), not a blank start.
```
