# Guide: CSS Resilience (content usable without stylesheets)

**Failure class:** `css-failure`
**Audit scenarios:** `block-css`
**Symptom:** with CSS blocked, content is unusable (invisible, misordered,
overlapping) — or the page breaks entirely.

## Root cause
Content depends on CSS for structure; no semantic HTML; critical layout in
external stylesheets with no fallback.

## Canonical pattern
1. Semantic HTML: content readable + ordered without CSS (headings, lists,
   main/nav, alt text).
2. Critical CSS inlined in `<head>`; the full sheet non-blocking.
3. Avoid `display:none`-on-load-then-JS patterns; use `<noscript>` fallbacks.
4. CSS containment + `content-visibility` for resilience/perf.

## Re-verify
`deno run -A harness/run-scenario.ts <url> --scenario block-css --screenshot` — pass: text readable + ordered; interactions still discoverable.
