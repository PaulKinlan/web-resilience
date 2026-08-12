// leak-probe.ts — memory/leak detection step. Samples DOM + listener counters
// before and after repeated interactions on a page and reports the deltas.
//
//   deno run -A harness/leak-probe.ts <url> [--loops 10] [--steps <interactions.json>]

import { CdpClient } from "./cdpc/cdp-client.ts";
import { launchChrome, closeChrome } from "./launch.ts";
import { planToScript, type InteractionPlan } from "./interactions.ts";

const url = Deno.args[0];
const loops = Number(Deno.args[Deno.args.indexOf("--loops") + 1] ?? 10);
const stepsPath = Deno.args.includes("--steps") ? Deno.args[Deno.args.indexOf("--steps") + 1] : undefined;
const plan: InteractionPlan | null = stepsPath
  ? JSON.parse(await Deno.readTextFile(stepsPath))
  : { name: "default", steps: [{ kind: "click", selector: "button" }] };

const { wsUrl, proc } = await launchChrome("/tmp/wr-leak-chrome", ["--enable-leak-detection"]);
const cdp = new CdpClient(wsUrl);
await cdp.ready();
const page = await cdp.send("Target.createTarget", { url });
const { sessionId } = await cdp.send("Target.attachToTarget", { targetId: page.targetId, flatten: true });
const sess = (m: string, p: Record<string, unknown> = {}) => cdp.send(m, p, sessionId);
await sess("Page.enable"); await sess("Runtime.enable");
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 500));
  try { const st = await sess("Runtime.evaluate", { expression: "document.readyState", returnByValue: true }); if (st.result?.value === "complete") break; } catch {}
}
await new Promise((r) => setTimeout(r, 1000));

async function counters() {
  try {
    let heap = -1;
    try { const h = await sess("Runtime.getHeapUsage"); heap = (h.usedSize as number) ?? -1; } catch {}
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
const script = planToScript(plan);
for (let i = 0; i < loops; i++) {
  try {
    await sess("Runtime.evaluate", { expression: script, awaitPromise: true, returnByValue: true });
  } catch { /* flow failed — record + continue */ }
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
console.log(JSON.stringify({ before, after, delta, loops, plan: plan.name }, null, 2));
// A growing node/listener count across loops = a leak to fix.
const verdict = delta.nodes > 50 || delta.jsEventListeners > 20
  ? "LEAK SUSPECTED"
  : "no growth";
console.log("verdict:", verdict);
await closeChrome(proc);
Deno.exit(0);
