# Guide: Font Resilience (font-display + fallback stacks)

**Failure class:** `font-display`
**Audit scenario:** `block-fonts`, `throttled-slow`, `throttled-2g`
**Symptom the audit catches:** under `block-fonts` the font faces report status
`error`/`unloaded`; the screenshot shows FOIT (invisible text while the font
times out) — the page text is present in the DOM but visually absent; under
throttling, LCP is delayed by a font that loads slowly.

## Root cause
`font-display: block` (the default) hides text until the webfont loads or fails;
slow/blocked font hosts (GFW, CDN outage, 2G) leave text invisible for seconds
or forever. Fallback stacks that are metric-incompatible cause layout shift
when the font finally arrives (CLS).

## Canonical pattern
1. `font-display: swap` (via `@font-face` or `&display=swap` on the CSS API) —
   text renders immediately in the fallback, swaps when the font arrives.
2. Metric-compatible fallback stacks (e.g. Arial/Helvetica for system-ui);
   follow modern-web-guidance `user-experience/visually-stable-font-fallbacks.md`.
3. `preload` the primary font file (`<link rel="preload" as="font">`) so it
   isn't discovered late; subset + woff2 to shrink the payload.
4. Consider `font-display: optional` for decorative faces (used for metrics
   only — fine to never swap).
5. Verify what actually rendered: `CSS.getPlatformFontsForNode` via the harness
   (the audit's `fonts` array) + the screenshot.

## Before / after
- `fixtures/resilient-club` — `display=block` + a failing font host: FOIT.
- `fixtures/reference` — `&display=swap`: text renders immediately in Georgia.

## Re-verify
```bash
deno run -A harness/run-scenario.ts <url> --scenario block-fonts --screenshot
# pass: the page text is visible (screenshot) + fonts report error but text renders
```

## Notes
- Also cover: font subsetting/unicode-range, `text-rendering`, and avoiding
  layout shift when the swapped font has different metrics (size-adjust).
