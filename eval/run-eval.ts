// run-eval.ts — the eval loop: fixture → audit → score vs rubric → (fix) → re-audit → delta.
// This is the ONLY place ground truth lives relative to the skills. The audit +
// fix skills never read the rubric; they only see URLs + CDP.

//   deno run -A eval/run-eval.ts <fixture-url> <rubric-json> [--screenshot] [--out <dir>]

import { CdpClient } from "../harness/cdpc/cdp-client.ts";
import { launchChrome, closeChrome } from "../harness/launch.ts";
import { SCENARIOS } from "../harness/scenarios.ts";
import type { ScenarioReport, AuditReport } from "../harness/types.ts";
import { scoreAudit, type RubricFinding } from "./score.ts";

const url = Deno.args[0];
const rubricPath = Deno.args[1];
const outDir = Deno.args[Deno.args.indexOf("--out") + 1] ?? "/tmp/web-resilience-eval";
await Deno.mkdir(outDir, { recursive: true });

const rubric = JSON.parse(await Deno.readTextFile(rubricPath)) as { fixture: string; version: number; expectedFindings: RubricFinding[] };

const { wsUrl, proc } = await launchChrome(`${outDir}/.chrome`);
const cdp = new CdpClient(wsUrl);
await cdp.ready();

async function runScenario(id: string): Promise<ScenarioReport> {
  const spec = SCENARIOS.find((s) => s.id === id)!;
  const failures: Record<string, unknown>[] = [];
  const consoleErrors: Record<string, unknown>[] = [];
  const exceptions: Record<string, unknown>[] = [];
  let crashDetected = false;
  const t0 = performance.now();
  const page = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId: page.targetId, flatten: true });
  const sess = (method: string, params: Record<string, unknown> = {}) => cdp.send(method, params, sessionId);
  await sess("Page.enable"); await sess("Runtime.enable"); await sess("Network.enable"); await sess("Log.enable");
  for (const c of spec.commands) { try { await sess(c.method, c.params); } catch {} }
  const unsub: Array<() => void> = [];
  if (spec.failAllWith) {
    await sess("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
    unsub.push(cdp.on("Fetch.requestPaused", async (p, sid) => { if (sid === sessionId) { try { await cdp.send("Fetch.failRequest", { requestId: p.requestId, errorReason: spec.failAllWith }, sessionId); } catch {} } }));
  }
  unsub.push(cdp.on("Network.loadingFailed", (p, sid) => { if (sid === sessionId) failures.push(p); }));
  unsub.push(cdp.on("Runtime.consoleAPICalled", (p, sid) => { if (sid === sessionId && p.type === "error") consoleErrors.push(p); }));
  unsub.push(cdp.on("Runtime.exceptionThrown", (p, sid) => { if (sid === sessionId) exceptions.push(p); }));
  unsub.push(cdp.on("Target.targetCrashed", (_, sid) => { if (sid === sessionId) crashDetected = true; }));
  let navSucceeded = false;
  try {
    await sess("Page.navigate", { url });
    for (let i = 0; i < 90; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const st = await sess("Runtime.evaluate", { expression: "document.readyState", returnByValue: true });
      if (st.result?.value === "complete") { navSucceeded = true; break; }
    }
  } catch {}
  await new Promise((r) => setTimeout(r, 1200));
  let pageTextSample: string | null = null;
  try { const t = await sess("Runtime.evaluate", { expression: "document.body ? document.body.innerText.slice(0, 1500) : null", returnByValue: true }); pageTextSample = t.result?.value ?? null; } catch {}
  for (const u of unsub) u();
  await cdp.send("Target.closeTarget", { targetId: page.targetId });
  return { scenario: id as never, url, startedAt: new Date().toISOString(), durationMs: Math.round(performance.now() - t0), navSucceeded, finalUrl: null, crashDetected, networkFailures: failures as never[], consoleErrors: consoleErrors as never[], uncaughtExceptions: exceptions as never[], perf: {}, fonts: [], pageTextSample, screenshotPath: null, extra: {} };
}

const scenarios = SCENARIOS.map((s) => s.id);
const reports: ScenarioReport[] = [];
for (const id of scenarios) reports.push(await runScenario(id));
const report: AuditReport = { url, engine: { chrome: "headless", cdpDomains: 57, runner: "web-resilience-eval" }, generatedAt: new Date().toISOString(), scenarios: reports };
await Deno.writeTextFile(`${outDir}/audit.json`, JSON.stringify(report, null, 2));

const score = scoreAudit(report, rubric);
console.log(JSON.stringify(score, null, 2));
await closeChrome(proc);
Deno.exit(0);
