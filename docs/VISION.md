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
2. **CLI:** screenshots are saved to `--out`. Optional `--vision <provider>`
   routes them to a vision-capable model for a text description (harness/vision.ts
   stub — wire Gemini via GEMINI_API_KEY or OpenAI).
3. **Resilience:** a text-only model can still run the full audit (structure >
   pixels for every current finding class). Vision adds: visual regressions,
   FOUT/FOIT perception, blank-page confirmation, layout breakage. Never block
   an audit on vision availability.

## TODO
- [ ] Wire a real vision provider adapter in harness/vision.ts (Gemini first —
      Paul's subscription — then OpenAI).
- [ ] Add an `--vision-model` flag mapping to the capability matrix.
