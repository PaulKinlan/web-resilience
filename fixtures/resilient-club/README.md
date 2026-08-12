# Fixture: resilient-club (issue-seeded)

Seeded issues (ground truth for the rubric):
1. Render-blocking stylesheet — no critical CSS, no `media` split.
2. webfont with `font-display: block` (via the font CSS) → FOIT; the font host is
   `fonts.example.invalid` so it ALWAYS fails to load → text invisible until the
   font timeout, then fallback. Tests font-display + fallback stacks.
3. One JS bundle that throws at the top level and owns all interactivity → no
   progressive enhancement; button dead when JS fails.

The `reference/` site is the same app with the issues fixed (font-display swap,
critical CSS inlined, resilient init, offline SW shell).

Run locally: `deno run -A fixtures/serve.ts <port>` then audit
`http://127.0.0.1:<port>/resilient-club/`.
