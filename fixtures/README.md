# Fixtures

Each fixture is a small site with **deliberately seeded defects**, and a rubric
in `eval/rubrics/` that says what an audit should find. The rubric is the ground
truth; the skills never see it.

| Fixture | Character | Hermetic |
|---|---|---|
| `resilient-club` | Naive site — single JS bundle, no offline story | ✅ |
| `reference` | Deliberately resilient — SW shell, font swap, permission-aware | ✅ |
| `spa-hydration` | Client-rendered SPA — nothing exists until JS runs | ✅ |
| `sw-dependency` | Treats its service worker as permanent infrastructure | ✅ |
| `csp-report-only` | A policy that would break the page if enforced | ✅ |
| `third-party` | Primary feature depends on a public CDN | ❌ needs internet |

## Writing a new fixture

> [!IMPORTANT]
> A fixture is only useful if its defects are **detectable by the harness**.
> The harness observes network failures, console errors, uncaught exceptions,
> browser diagnostics, font status and page text. It does no static analysis
> and has no memory across runs.
>
> This rules out temporal defects. "Users are stuck on v1 after you deploy v2"
> cannot be asserted, because the harness audits one version at one moment.
> `sw-dependency` exists because that was the detectable half of the idea:
> *the app breaks when the worker is absent*.

Write the rubric **from observed behaviour**, not from intent. Run the audit
first and read the actual signals; a rubric entry whose signal never appears is
unscoreable and silently caps the fixture's score.

## Per-fixture server behaviour

Two opt-in marker files, so a fixture declares its own requirements instead of
`serve.ts` accumulating special cases:

| File | Effect |
|---|---|
| `<fixture>/.spa` | unknown paths fall back to that fixture's `index.html` |
| `<fixture>/.headers.json` | extra response headers on that fixture's HTML |

`csp-report-only` needs the second one because
`Content-Security-Policy-Report-Only` is only honoured as a real header — the
`<meta>` form is ignored by the spec, so the fixture cannot be purely static.

## Interaction plans

`fixtures/plans/` holds example flows for `--plan`. Some defects only appear on
interaction: `third-party`'s dead button throws a `ReferenceError` on click, but
the page text is byte-identical whether or not the CDN loaded.
