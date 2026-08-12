// vision.ts — the vision-capability abstraction. The audit takes screenshots;
// different LLMs have different vision capabilities. This module keeps the
// harness model-agnostic:
//
//  - IN-SESSION (pi / Claude Code / Codex): screenshots are written to the
//    report dir and ATTACHED to the model's context — the model sees them if
//    its provider supports images (Anthropic, OpenAI, Gemini do; DeepSeek/GLM
//    text-only routes do not).
//  - CLI: screenshots are saved; pass `--vision <provider>` to send them to a
//    vision-capable model for analysis. The harness NEVER depends on a
//    particular provider.
//
// Capability matrix (2026-08): vision-capable — anthropic/claude-*, openai/gpt-4o*,
// google/gemini-*-pro, google/gemini-flash; text-only — deepseek/*, zai/glm-*,
// qwen-* (check provider docs). The `analyseScreenshot` path below is a stub
// that must be wired to a provider the user has tokens for.

export interface VisionResult {
  provider: string | null;
  analyzed: boolean; // false when no vision provider is configured/available
  text: string | null;
}

/** Decide whether the harness should attempt visual analysis for a provider. */
export function providerHasVision(model: string | null): boolean {
  if (!model) return false;
  const m = model.toLowerCase();
  if (m.includes("claude")) return true;
  if (m.includes("gpt-4o") || m.includes("gpt-5") || m.includes("openai")) return true;
  if (m.includes("gemini")) return true;
  if (m.includes("qwen-vl") || m.includes("qwen2.5-vl")) return true;
  return false; // deepseek, glm, etc. — text-only (unless the provider adds vision)
}

/** Route a screenshot to a vision-capable model (stub — wire to a provider). */
export async function analyseScreenshot(
  path: string,
  provider: string | null,
): Promise<VisionResult> {
  if (!provider) {
    return { provider: null, analyzed: false, text: null };
  }
  // TODO(paulk): wire provider adapters (gemini via GEMINI_API_KEY, openai, etc.)
  // The harness contract: return a text description of what the screenshot shows
  // that is relevant to the injected scenario (blank page? FOUT? missing assets?).
  return { provider, analyzed: false, text: null };
}

/** The audit skill's guidance: when to attach screenshots vs. rely on text. */
export const VISION_GUIDANCE = `Screenshots are captured for every scenario. In an agent
session, attach them to the model context when the model's provider is
vision-capable (Anthropic/OpenAI/Gemini). For text-only models (DeepSeek, GLM),
the harness ALSO records: page text sample, network failures, console errors,
font status, and perf metrics — so the audit remains effective without vision.
CLI users can pass --vision <provider> to analyse screenshots separately.`;
