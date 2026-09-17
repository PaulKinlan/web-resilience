// leak-probe.ts — memory/leak detection step. Samples DOM + listener counters
// before and after repeated interactions on a page and reports the deltas.
//
//   deno run -A harness/leak-probe.ts <url> [--loops 10] [--steps <interactions.json>]

import { CdpClient } from "./cdpc/cdp-client.ts";
import { launchChrome, closeChrome } from "./launch.ts";
import { parsePlan, runPlan, type InteractionPlan } from "./interactions.ts";

const url = Deno.args[0];
if (!url) {
  console.error("usage: leak-probe <url> [--loops 10] [--steps <interactions.json>]");
  Deno.exit(1);
}

/** Read `--name value`. `indexOf` returns -1 when absent, which would other-
 * wise read args[0] (the url) as the value. */
function option(name: string): string | undefined {
  const index = Deno.args.indexOf(`--${name}`);
  return index === -1 ? undefined : Deno.args[index + 1];
}

// `??` does not catch NaN, so `Number(url) ?? 10` used to yield NaN here and
// `i < NaN` is false — the probe ran zero loops and reported on nothing.
const requestedLoops = Number(option("loops"));
const loops = Number.isFinite(requestedLoops) && requestedLoops > 0 ? requestedLoops : 10;

const stepsPath = option("steps");
// parsePlan, not JSON.parse: --steps should accept a DevTools Recorder export
// exactly as `audit --plan` does.
const plan: InteractionPlan = stepsPath
  ? parsePlan(await Deno.readTextFile(stepsPath))
  : { name: "default", steps: [{ kind: "click", selector: "button" }] };

const { wsUrl, proc } = await launchChrome("/tmp/wr-leak-chrome", ["--enable-leak-detection"]);
const cdp = new CdpClient(wsUrl);
await cdp.ready();
const page = await cdp.send("Target.createTarget", { url });
const { sessionId } = await cdp.send("Target.attachToTarget", { targetId: page.targetId, flatten: true });
const sess = (m: string, p: Record<string, unknown> = {}) => cdp.send(m, p, sessionId as string);
await sess("Page.enable"); await sess("Runtime.enable");
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 500));
  try {
    const st = await sess("Runtime.evaluate", { expression: "document.readyState", returnByValue: true });
    if ((st.result as { value?: string })?.value === "complete") break;
  } catch { /* target not ready yet */ }
}

await new Promise((r) => setTimeout(r, 1000));

async function counters() {
  try {
    let heap = -1;
    try {
      const h = await sess("Runtime.getHeapUsage");
      heap = (h.usedSize as number) ?? -1;
    } catch { /* heap usage is unavailable in some headless builds */ }

    const c = await sess("Memory.getDOMCounters");
    return {
      nodes: (c.nodes as number) ?? 0,
      jsEventListeners: (c.jsEventListeners as number) ?? 0,
      jsHeapSize: heap,
    };
  } catch (e) {
    return { nodes: -1, jsEventListeners: -1, jsHeapSize: -1, error: String(e) };
  }
}

const before = await counters();
let loopsCompleted = 0;
let lastFlowError: string | null = null;
for (let i = 0; i < loops; i++) {
  const result = await runPlan(sess, plan);
  if (result.completed) {
    loopsCompleted++;
  } else {
    lastFlowError = result.steps[result.failedAt ?? 0]?.error ?? "unknown";
  }
  await new Promise((r) => setTimeout(r, 400)); // let GC/observers settle
}

try { await sess("Memory.prepareForLeakDetection"); } catch { /* optional — some headless builds lack it */ }
await new Promise((r) => setTimeout(r, 1000));
const after = await counters();

const delta = {
  nodes: after.nodes - before.nodes,
  jsEventListeners: after.jsEventListeners - before.jsEventListeners,
  jsHeapSize: after.jsHeapSize - before.jsHeapSize,
};
console.log(JSON.stringify({
  before,
  after,
  delta,
  loops,
  loopsCompleted,
  lastFlowError,
  plan: plan.name,
}, null, 2));

// A growing node/listener count across loops = a leak to fix. But if the flow
// never actually ran, "no growth" means nothing — say so instead of implying
// the page is clean.
const verdict = loopsCompleted === 0
  ? `INCONCLUSIVE — the flow never completed (${lastFlowError ?? "unknown"})`
  : delta.nodes > 50 || delta.jsEventListeners > 20
  ? "LEAK SUSPECTED"
  : "no growth";

console.log("verdict:", verdict);
cdp.close();
await closeChrome(proc);
Deno.exit(0);
