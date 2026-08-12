# Guide: Asset Starvation Under Throttling

**Failure class:** `asset-starve`
**Audit scenarios:** `throttled-slow`, `throttled-2g`, `cpu-6x`, `cpu-20x`
**Symptom:** LCP-critical resources delayed, fonts swap late, images stream,
first paint suffers — the page "works" on fiber and dies on 2G.

## Root cause
No prioritization: render-blocking CSS/JS, no preload for the LCP image/font,
below-fold media eager-loaded, unoptimized payloads.

## Canonical pattern
1. `fetchpriority=high` on the LCP image; `preload` the primary font.
2. Lazy-load below-fold images/videos (`loading=lazy`, `decoding=async`).
3. Responsive images (`srcset`/`sizes`), modern codecs (avif/webp), brotli/gzip.
4. Critical CSS inlined; render-blocking non-critical removed.
5. `content-visibility` for off-screen sections.

## Re-verify
`deno run -A harness/run-scenario.ts <url> --scenario throttled-2g` — pass: LCP asset prioritized, text renders in fallback fonts, no long-empty regions.
