# Guide: Low-Memory Devices

**Failure class:** `memory`
**Audit scenarios:** `memory-critical`, `tab-crash`, `cpu-20x`
**Symptom:** pages discarded/crashed on low-RAM devices; state lost; the heavy
heap amplifies pressure.

## Root cause
Large JS heaps (no code-splitting, heavy libraries, DOM bloat) + leaks; nothing
persists state for crash/discard recovery; renderer dies under pressure.

## Canonical pattern
1. Reduce heap: code-splitting, defer heavy features, `content-visibility`,
   avoid huge strings/DOM.
2. Fix leaks (guide: fix-skill leak patterns — listener cleanup, detached nodes).
3. Persist critical state as it changes; recover on reload (`wasDiscarded`).
4. Watch memory via the leak-probe: `leak-probe.ts --loops 10`.

## Re-verify
`deno run -A harness/run-scenario.ts <url> --scenario memory-critical` + `tab-crash` — pass: state survives discard/crash + reload recovers.
