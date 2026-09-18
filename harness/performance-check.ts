// Real-Chrome performance contract regression (requires a clean committed tree).
// Start: deno run -A fixtures/serve.ts 8876
// Run: WR_CHROME=/path/to/chrome deno run -A harness/performance-check.ts \
//        http://127.0.0.1:8876/reference/ /tmp/wr-perf-unique-output
// Use a NEW output directory each time: cold-offline requires a fresh profile.
// No fixture/rubric source is modified.
import { assert, assertEquals } from "@std/assert";
import { CdpClient } from "./cdpc/cdp-client.ts";
import { closeChrome, launchChrome } from "./launch.ts";
import { capturePerf, primeServiceWorker, runScenario } from "./audit.ts";
import { SCENARIOS } from "./scenarios.ts";
import type { InteractionPlan } from "./interactions.ts";
import type { ScenarioReport } from "./types.ts";

const [url, outDir] = Deno.args;
assert(url && outDir, "fixture URL and fresh output directory required");
const git = async (...args: string[]) => {
  const result = await new Deno.Command("git", {
    cwd: new URL("../", import.meta.url),
    args,
    stdout: "piped",
  }).output();
  assert(result.success);
  return new TextDecoder().decode(result.stdout).trim();
};
const candidateCommit = await git("rev-parse", "HEAD");
assertEquals(await git("status", "--porcelain"), "", "candidate must be clean");
// Refuse to reuse a browser profile: otherwise the cold-offline control lies.
await Deno.mkdir(outDir);
const { proc, wsUrl, binary } = await launchChrome(`${outDir}/.chrome`);
const cdp = new CdpClient(wsUrl);
await cdp.ready();
const send = cdp.send.bind(cdp);
const sessions = new Map<string, string>();
const oracles: Array<Record<string, unknown>> = [];
let lastSession = "";
let currentCase = "cold-offline";

// Independently read native buffered entries immediately before each target is
// closed. Do not trust the candidate's __webResilienceVitals global as the oracle.
cdp.send = async (method, params = {}, sessionId, timeoutMs) => {
  if (method === "Input.dispatchMouseEvent" && params.type === "mousePressed") {
    const shot = await send("Page.captureScreenshot", { format: "png" }, sessionId);
    await Deno.writeFile(
      `${outDir}/${currentCase}/before-click.png`,
      Uint8Array.from(atob(String(shot.data)), (c) => c.charCodeAt(0)),
    );
  }
  if (method === "Target.closeTarget") {
    const sid = sessions.get(String(params.targetId));
    if (sid) {
      lastSession = sid;
      const pm = await send("Performance.getMetrics", {}, sid);
      const result = await send("Runtime.evaluate", {
        expression: `new Promise(resolve => {
          const n = performance.getEntriesByType("navigation")[0];
          const paints = performance.getEntriesByName("first-contentful-paint");
          const lcp = [], shifts = [], observers = [];
          for (const [type, entries] of [["largest-contentful-paint", lcp], ["layout-shift", shifts]]) {
            const observer = new PerformanceObserver(list => entries.push(...list.getEntries()));
            observer.observe({ type, buffered: true });
            observers.push(observer);
          }
          setTimeout(() => {
            for (const observer of observers) observer.disconnect();
            resolve({
              nav: { fcp: paints[0]?.startTime ?? null, lcp: lcp.at(-1)?.startTime ?? null,
                cls: shifts.filter(e => !e.hadRecentInput).reduce((sum,e) => sum + e.value, 0),
                dcl: n?.domContentLoadedEventEnd ?? null, load: n?.loadEventEnd ?? null },
              responseStart: n?.responseStart ?? null,
              eligibleShifts: shifts.filter(e => !e.hadRecentInput).length,
              ignoredShifts: shifts.filter(e => e.hadRecentInput).length,
              statusText: document.querySelector("#status")?.textContent ?? null,
              online: navigator.onLine,
              swControlled: Boolean(navigator.serviceWorker?.controller),
              finalUrl: location.href,
            });
          }, 80);
        })`,
        returnByValue: true,
        awaitPromise: true,
      }, sid);
      assert(!result.exceptionDetails, "native oracle must execute without an exception");
      const value = (result.result as { value: Record<string, unknown> }).value;
      oracles.push({
        ...value,
        metricNames: (pm.metrics as Array<{ name: string }>).map((m) => m.name).sort(),
      });
    }
  }
  const result = await send(method, params, sessionId, timeoutMs);
  if (method === "Target.attachToTarget") {
    sessions.set(String(params.targetId), String(result.sessionId));
  }
  return result;
};

function checkPerf(report: ScenarioReport, oracle: Record<string, unknown>) {
  assert(!report.harnessError && !report.crashDetected);
  assertEquals(report.extra.injectionErrors, []);
  assert(Object.keys(report.perf.metrics).length > 10, "real nonempty CDP map");
  assertEquals(
    Object.keys(report.perf.metrics).sort(),
    oracle.metricNames,
    "retain every native metric",
  );
  assertEquals(
    report.perf.nav,
    oracle.nav,
    "timings match independent native paint/shift/navigation entries",
  );
  const { nav } = report.perf;
  assert(nav.fcp !== null && nav.fcp > 0 && nav.lcp !== null && nav.lcp > 0);
  assert(nav.cls !== null && nav.cls >= 0);
  assert(nav.fcp !== oracle.responseStart, "FCP must not be responseStart");
  assertEquals([
    report.perf.fcpMs,
    report.perf.lcpMs,
    report.perf.cls,
    report.perf.domContentLoadedMs,
    report.perf.loadMs,
  ], [nav.fcp, nav.lcp, nav.cls, nav.dcl, nav.load]);
  assert(report.screenshotPath && Deno.statSync(report.screenshotPath).size > 1000);
}

const plan: InteractionPlan = {
  name: "reference Join interaction",
  steps: [
    { kind: "assert-text", text: "Resilient Club" },
    { kind: "click", selector: "#join" },
    { kind: "wait", ms: 150 },
  ],
};
const results: Record<string, unknown> = {
  candidateCommit,
  generatedAt: new Date().toISOString(),
};
try {
  results.chrome = await cdp.send("Browser.getVersion");
  results.binary = binary;
  // Calibration: without an installed worker/cache, offline cannot load the app.
  await Deno.mkdir(`${outDir}/cold-offline`);
  const cold = await runScenario(cdp, SCENARIOS.find((s) => s.id === "offline")!, {
    url,
    outDir: `${outDir}/cold-offline`,
    screenshot: true,
  });
  assert(
    cold.networkFailures.some((f) => f.errorText === "net::ERR_INTERNET_DISCONNECTED"),
  );
  assert(!cold.pageTextSample?.includes("We test how websites survive"));
  results.coldOffline = cold;

  for (const scenario of ["baseline", "offline"]) {
    currentCase = scenario;
    if (scenario === "offline") await primeServiceWorker(cdp, url);
    const dir = `${outDir}/${scenario}`;
    await Deno.mkdir(dir, { recursive: true });
    const report = await runScenario(cdp, SCENARIOS.find((s) => s.id === scenario)!, {
      url,
      outDir: dir,
      screenshot: true,
      plan,
    });
    const oracle = oracles.at(-1)!;
    checkPerf(report, oracle);
    assert(report.navSucceeded && report.finalUrl === url);
    assert(report.pageTextSample?.includes("We test how websites survive"));
    assert((report.extra.interactions as { completed: boolean }).completed);
    assert(
      /Welcome!|You're offline/.test(String(oracle.statusText)),
      "Join visibly changes the UI",
    );
    if (scenario === "offline") assertEquals(oracle.swControlled, true);
    await Deno.writeTextFile(
      `${dir}/report.json`,
      JSON.stringify({ report, oracle }, null, 2),
    );
    results[scenario] = { report, oracle };
  }

  // Separate synthetic measurement page, NOT an eval fixture: force late LCP,
  // a non-input shift and a real-click shift. Native entries are the oracle.
  const html = `<!doctype html><style>body{margin:30px}h1{font-size:24px}</style>
    <script>const end = performance.now()+100; while(performance.now()<end){}</script>
    <div id="spacer"></div><h1 id="hero">Paint probe</h1><div id="recent"></div>
    <button id="shift">Shift after input</button><p>Real metric collection</p>
    <script>
      setTimeout(()=>hero.insertAdjacentHTML("afterend",'<h2 style="font-size:56px;margin:10px 0">Late largest paint</h2>'),300);
      setTimeout(()=>spacer.style.height="90px",700);
      shift.addEventListener("click",()=>recent.style.height="100px");
    </script>`;
  currentCase = "measurement-probe";
  const dir = `${outDir}/measurement-probe`;
  await Deno.mkdir(dir, { recursive: true });
  const probe = await runScenario(cdp, SCENARIOS.find((s) => s.id === "baseline")!, {
    url: `data:text/html,${encodeURIComponent(html)}`,
    outDir: dir,
    screenshot: true,
    plan: {
      name: "input-associated shift excluded",
      steps: [
        { kind: "click", selector: "#shift" },
        { kind: "wait", ms: 150 },
      ],
    },
  });
  const oracle = oracles.at(-1)!;
  results.measurementProbe = { report: probe, oracle };
  checkPerf(probe, oracle);
  assert(
    probe.perf.nav.lcp! > probe.perf.nav.fcp!,
    "late largest paint must replace the initial paint",
  );
  assert(probe.perf.nav.cls! > 0, "actual unprompted shift is measured");
  assert(Number(oracle.eligibleShifts) > 0 && Number(oracle.ignoredShifts) > 0);

  // This session really belonged to a now-closed Chrome target. CDP must reject
  // it; the production capture path must emit all nulls, not zero or {}.
  const missing = await capturePerf((method, params) =>
    cdp.send(method, params, lastSession)
  );
  assertEquals(missing, {
    metrics: {},
    nav: { fcp: null, lcp: null, cls: null, dcl: null, load: null },
    fcpMs: null,
    lcpMs: null,
    cls: null,
    domContentLoadedMs: null,
    loadMs: null,
  });
  results.closedTarget = missing;
  assertEquals(await git("rev-parse", "HEAD"), candidateCommit);
  assertEquals(await git("status", "--porcelain"), "");
  results.status = "PASS";
  console.log(
    "PASS: baseline + primed offline Join journeys; native metric/FCP/LCP/CLS parity; measured zero vs missing null; late LCP; non-input/input shifts; closed real target defaults.",
  );
} finally {
  await Deno.writeTextFile(`${outDir}/evidence.json`, JSON.stringify(results, null, 2));
  cdp.close();
  await closeChrome(proc);
}
