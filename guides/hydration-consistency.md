# Guide: SSR Hydration Consistency

**Failure class:** hydration
**Audit scenarios:** baseline + throttled on an SSR fixture (capture mismatch warnings)
**Symptom:** server/client first render diverge → flicker, rerenders, broken
interactive state.

## Root cause
Browser-only values in render (Date, Math.random, window/navigator),
locale/timezone variance, auth/feature-flag divergence, third-party DOM touches.

## Canonical pattern
1. Deterministic renders: no Date/random/window in the render path.
2. Isolate browser-only effects in effects/hydration-safe branches.
3. Test in production build mode; collect recoverable errors.
4. Suspense boundaries isolate mismatches.

## Re-verify
SSR fixture under `baseline`: no hydration-mismatch warnings in consoleErrors.
