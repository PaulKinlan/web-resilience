# Vision capability & routing

The audit captures screenshots for every scenario. Different models see
differently; the harness must never lock to one provider.

## Capability matrix (2026-08)

| Provider / model family | Vision? | Notes |
|---|---|---|
| anthropic/claude-* | Yes | native image input |
| openai/gpt-4o, gpt-5 | Yes | native image input |
| google/gemini-*-pro / flash | Yes | via the user's Gemini subscription (GEMINI_API_KEY) |
| deepseek/* | No | text-only |
| zai/glm-* | No (GLM-4V/4.5V variants exist — check) | text-only unless a VL variant is used |
| qwen2.5-vl / qwen-vl | Yes | vision variants only |

## Routing rules

1. **In-session (pi / Claude Code / Codex):** write screenshots to the report
   dir and attach them to the model context. If the active model's provider is
   vision-capable, the model sees them. If text-only (DeepSeek/GLM), do NOT
   attach — the harness's structured signals (network failures, console errors,
   font status, page text, perf) carry the audit.
2. **CLI:** screenshots are saved to `--out`. `wr vision <audit-dir>` runs them
   through Gemini as a **separate pass** and writes the result into each
   scenario's `extra.vision` in `audit.json`. Splitting it from the audit means
   a capture can happen on a machine with no egress and be analysed later.
3. **Resilience:** a text-only model can still run the full audit (structure >
   pixels for every current finding class). Vision adds: visual regressions,
   FOUT/FOIT perception, blank-page confirmation, layout breakage. Never block
   an audit on vision availability.

## Implementation (harness/vision.ts)

- `analyseScreenshot(path, opts)` — one screenshot → structured verdict
  (`usable` / `degraded` / `broken`, plus `blankPage`, `primaryContentVisible`,
  `layoutIntact`, `observations[]`) via Gemini's `responseSchema`.
- `annotateAudit(auditPath, opts)` — the whole report, in place.
- **Per-scenario prompts.** A generic "describe this image" wastes the call;
  each scenario has its own question (offline → "site-authored offline state or
  browser error page?", block-fonts → "FOUT or FOIT?", block-css → "readable in
  source order?"). A browser error page is `broken`; a site-authored offline
  state is `degraded`.
- **Never throws.** Missing key, non-vision model, HTTP error, unreadable PNG —
  all return `analyzed: false` with a `skipped` reason recorded in the report,
  so an absent analysis is always explained rather than silently empty.
- Model: `--model`, else `WR_VISION_MODEL`, else `gemini-3.8-flash`.
  Key: `GEMINI_API_KEY` or `GOOGLE_API_KEY`.

> [!NOTE]
> The skip paths are verified; a live end-to-end call has not been exercised in
> this repo (no API key was available at the time of writing). The request
> shape follows the v1beta `generateContent` contract with `inline_data`.

## TODO
- [ ] Exercise a live call and pin the response-parsing against a real payload.
- [ ] OpenAI adapter (same `VisionResult` contract) for non-Gemini users.

