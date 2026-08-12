# Guide: Single-Core / Low-Hardware Devices

**Failure class:** `concurrency`
**Audit scenarios:** `hardware-concurrency`, `cpu-20x`
**Symptom:** worker pools assume N cores; the main thread saturates; heavy
parallelism janks single-core devices.

## Root cause
Code spawns workers/parallel work based on a fixed assumption instead of
`navigator.hardwareConcurrency`; main-thread work not yielded.

## Canonical pattern
1. Cap pools: `Math.min(navigator.hardwareConcurrency, 4)` etc.
2. Yield to the main thread (slices, scheduler.yield) for long work.
3. Feature-detect worker availability; fall back to main-thread processing.
4. Lazy-init heavy work (only when needed).

## Re-verify
`deno run -A harness/run-scenario.ts <url> --scenario hardware-concurrency` + `cpu-20x` — pass: no unbounded worker storm, interactions stay responsive.
