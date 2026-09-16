// vision.ts — screenshot analysis for the audit.
//
// The harness captures a PNG per scenario. Structured signals (network
// failures, console errors, font status, page text, perf) carry every current
// finding class on their own, so vision is strictly ADDITIVE and must never
// block an audit: no key, no network, unsupported model — the audit still
// completes and simply reports that vision was unavailable.
//
// What vision adds over the structured signals:
//   - "the page is blank" (a 200 response with an empty render looks fine in
//     the network log)
//   - FOIT vs FOUT perception (fonts report `error` either way)
//   - layout collapse without CSS (no error is logged for ugly)
//   - dead/unreachable UI that is technically present in the DOM
//
// Usage:
//   wr vision /tmp/audit-site                 # annotate an existing audit.json
//   wr vision /tmp/audit-site --model gemini-3.5-flash

import type { AuditReport, ScenarioReport } from "./types.ts";

/** Model families that accept image input. The list moves; keep it permissive. */
export function providerHasVision(model: string | null): boolean {
  if (!model) return false;
  const m = model.toLowerCase();
  if (m.includes("claude")) return true;
  if (m.includes("gpt-4o") || m.includes("gpt-5") || m.includes("openai")) return true;
  if (m.includes("gemini")) return true;
  if (m.includes("qwen-vl") || m.includes("qwen2.5-vl")) return true;
  return false; // deepseek, glm, etc. — text-only (unless the provider adds vision)
}

export interface VisionResult {
  provider: string | null;
  model: string | null;
  analyzed: boolean;
  /** Why analysis did not happen — surfaced so a null result is never silent. */
  skipped?: string;
  verdict?: "usable" | "degraded" | "broken";
  blankPage?: boolean;
  primaryContentVisible?: boolean;
  layoutIntact?: boolean;
  observations?: string[];
  text?: string | null;
}

export interface VisionOptions {
  model?: string;
  apiKey?: string;
  /** Scenario id, used to ask the question that scenario is actually about. */
  scenario?: string;
  /** What the harness injected, so the model knows what SHOULD have happened. */
  scenarioDescription?: string;
}

const DEFAULT_MODEL = "gemini-3.8-flash";
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * Scenario-specific questions. A generic "describe this screenshot" wastes the
 * call — each failure mode has a different visual tell.
 */
const SCENARIO_QUESTIONS: Record<string, string> = {
  offline:
    "The network was fully offline. Is this a usable offline experience (cached shell, offline notice) or a browser error/blank page?",
  "dns-fail":
    "Every request failed DNS resolution. Did the site render anything of its own, or is this a browser error page?",
  "internet-disconnect":
    "The connection was severed. Is there an app-provided offline state, or a browser error?",
  "block-js":
    "All JavaScript was blocked. Is the core content readable and the page usable without JS, or is it blank/skeleton/dead UI?",
  "block-css":
    "All CSS was blocked. Is the content still readable in source order, or is it unusable?",
  "block-fonts":
    "Web fonts were blocked. Is text rendered in a fallback (FOUT) or invisible/missing (FOIT)? Note any layout shift or clipping.",
  "block-images":
    "Images were blocked. Are there graceful placeholders/alt text, or broken-image icons and collapsed layout?",
  "throttled-slow":
    "The network was heavily throttled. Does the page show meaningful content or an empty/skeleton state?",
  "throttled-2g":
    "2G conditions. Is anything useful painted, or is the viewport empty?",
  "cpu-20x":
    "CPU was throttled 20x. Does the page appear rendered, or stuck mid-render/unstyled?",
  "memory-critical":
    "Critical memory pressure was signalled. Does the UI look intact or degraded/crashed?",
  "tab-crash":
    "The tab was crashed. Is this a crash/sad-tab page?",
  incognito:
    "Private browsing. Does the UI show a state that depends on persistent storage being unavailable (e.g. a broken login or empty data view)?",
};

const GENERIC_QUESTION =
  "Is the page usable? Note anything visually broken: blank areas, missing content, collapsed layout, error states.";

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["usable", "degraded", "broken"] },
    blankPage: { type: "boolean" },
    primaryContentVisible: { type: "boolean" },
    layoutIntact: { type: "boolean" },
    observations: { type: "array", items: { type: "string" } },
  },
  required: [
    "verdict",
    "blankPage",
    "primaryContentVisible",
    "layoutIntact",
    "observations",
  ],
};

function apiKeyFrom(options: VisionOptions): string | undefined {
  return options.apiKey ?? Deno.env.get("GEMINI_API_KEY") ??
    Deno.env.get("GOOGLE_API_KEY") ?? undefined;
}

/** Route one screenshot to Gemini. Returns a structured, never-throwing result. */
export async function analyseScreenshot(
  path: string,
  options: VisionOptions = {},
): Promise<VisionResult> {
  const model = options.model ?? Deno.env.get("WR_VISION_MODEL") ?? DEFAULT_MODEL;
  const key = apiKeyFrom(options);
  const base: VisionResult = { provider: "gemini", model, analyzed: false };

  if (!key) {
    return {
      ...base,
      skipped: "no GEMINI_API_KEY / GOOGLE_API_KEY in the environment",
    };
  }
  if (!providerHasVision(model)) {
    return { ...base, skipped: `model ${model} is not vision-capable` };
  }

  let image: Uint8Array;
  try {
    image = await Deno.readFile(path);
  } catch (error) {
    return { ...base, skipped: `screenshot unreadable: ${String(error)}` };
  }

  const question = (options.scenario && SCENARIO_QUESTIONS[options.scenario]) ??
    GENERIC_QUESTION;
  const prompt = [
    "You are auditing a web page screenshot taken under an injected failure condition.",
    options.scenarioDescription ? `Condition: ${options.scenarioDescription}` : "",
    `Question: ${question}`,
    "",
    "Judge only what is visible. A browser error page (e.g. ERR_INTERNET_DISCONNECTED)",
    "is 'broken'. A site-authored offline/error state is 'degraded', not 'broken'.",
  ].filter(Boolean).join("\n");

  try {
    const response = await fetch(
      `${ENDPOINT}/${model}:generateContent`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": key,
        },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              {
                inline_data: {
                  mime_type: "image/png",
                  data: base64(image),
                },
              },
            ],
          }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: RESPONSE_SCHEMA,
          },
        }),
      },
    );

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      return { ...base, skipped: `HTTP ${response.status}: ${detail}` };
    }

    const body = await response.json();
    const text = body?.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
    if (!text) return { ...base, skipped: "empty response from the model" };

    const parsed = JSON.parse(text);
    return {
      ...base,
      analyzed: true,
      verdict: parsed.verdict,
      blankPage: parsed.blankPage,
      primaryContentVisible: parsed.primaryContentVisible,
      layoutIntact: parsed.layoutIntact,
      observations: parsed.observations,
      text,
    };
  } catch (error) {
    // Vision is additive: a failure here must never fail the audit.
    return { ...base, skipped: String(error) };
  }
}

/**
 * Annotate an existing audit.json in place, adding `extra.vision` per scenario.
 * Runs as a separate pass so an audit can be captured on one machine (or with
 * no network egress) and analysed later.
 */
export async function annotateAudit(
  auditPath: string,
  options: VisionOptions = {},
): Promise<{ analyzed: number; skipped: number }> {
  const report = JSON.parse(await Deno.readTextFile(auditPath)) as AuditReport;
  let analyzed = 0;
  let skipped = 0;

  for (const scenario of report.scenarios as ScenarioReport[]) {
    if (!scenario.screenshotPath) {
      skipped++;
      continue;
    }
    const result = await analyseScreenshot(scenario.screenshotPath, {
      ...options,
      scenario: scenario.scenario,
    });
    scenario.extra = { ...scenario.extra, vision: result };
    result.analyzed ? analyzed++ : skipped++;
    console.log(
      `[${scenario.scenario}] ${
        result.analyzed ? result.verdict : `skipped — ${result.skipped}`
      }`,
    );
  }

  await Deno.writeTextFile(auditPath, JSON.stringify(report, null, 2));
  return { analyzed, skipped };
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000; // avoid blowing the argument limit on large screenshots
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** The audit skill's guidance: when to attach screenshots vs. rely on text. */
export const VISION_GUIDANCE =
  `Screenshots are captured for every scenario. In an agent session, attach them
to the model context when the model's provider is vision-capable
(Anthropic/OpenAI/Gemini). For text-only models (DeepSeek, GLM), the harness
ALSO records: page text sample, network failures, console errors, font status,
and perf metrics — so the audit remains effective without vision. CLI users can
run \`wr vision <audit-dir>\` to analyse the screenshots with Gemini.`;

if (import.meta.main) {
  const target = Deno.args[0];
  if (!target) {
    console.error("usage: vision <audit-dir|audit.json> [--model <name>]");
    Deno.exit(1);
  }
  const modelIndex = Deno.args.indexOf("--model");
  const model = modelIndex === -1 ? undefined : Deno.args[modelIndex + 1];

  const auditPath = target.endsWith(".json") ? target : `${target}/audit.json`;
  const summary = await annotateAudit(auditPath, { model });
  console.log(
    `\nvision: ${summary.analyzed} analyzed, ${summary.skipped} skipped → ${auditPath}`,
  );
  Deno.exit(0);
}
