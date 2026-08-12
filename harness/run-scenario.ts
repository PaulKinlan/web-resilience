// run-scenario.ts — CLI entry: audit ONE url through ONE (or all) scenarios.
//
//   deno run -A harness/run-scenario.ts https://example.com \
//     --scenario offline --out /tmp/audit --screenshot
//
// Emits a JSON ScenarioReport per scenario + optional screenshots. The report
// is the audit skill's raw input; the eval framework scores it.

import { CdpClient } from "./cdpc/cdp-client.ts";
import { launchChrome, closeChrome } from "./launch.ts";
import { SCENARIOS } from "./scenarios.ts";
import type { ScenarioReport, AuditReport } from "./types.ts";

const args = Deno.args;
const url = args[0] ?? (() => { console.error("usage: run-scenario <url> [--scenario <id>] [--out <dir>] [--screenshot] [--all]"); Deno.exit(1); })();
const scenarioArg = args[args.indexOf("--scenario") + 1];
const outDir = args[args.indexOf("--out") + 1] ?? "/tmp/web-resilience-audit";
const wantScreenshot = args.includes("--screenshot");
const all = args.includes("--all");
const targets = all ? SCENARIOS.map((s) => s.id) : [scenarioArg ?? "baseline"];

await Deno.mkdir(outDir, { recursive: true });

const { wsUrl, proc } = await launchChrome(`${outDir}/.chrome`);
const cdp = new CdpClient(wsUrl);
await cdp.ready();

const reports: ScenarioReport[] = [];
for (const id of targets) {
  const spec = SCENARIOS.find((s) => s.id === id)!;
  const failures: Record<string, unknown>[] = [];
  const consoleErrors: Record<string, unknown>[] = [];
  const exceptions: Record<string, unknown>[] = [];
  let crashDetected = false;
  const startedAt = new Date().toISOString();
  const t0 = performance.now();

  const page = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId: page.targetId, flatten: true });
  const sess = (method: string, params: Record<string, unknown> = {}) => cdp.send(method, params, sessionId);
  await sess("Page.enable"); await sess("Runtime.enable"); await sess("Network.enable"); await sess("Log.enable");

  // Apply scenario commands (origin substitution — use the TARGET's origin,
  // not about:blank's, so permission/quota denials apply to the site).
  const origin = new URL(url).origin;
  const commands = spec.commands.map((c) => ({
    method: c.method,
    params: Object.fromEntries(
      Object.entries(c.params).map(([k, v]) => [k, v === "%ORIGIN%" ? origin : v]),
    ),
  }));
  for (const c of commands) {
    try { await sess(c.method, c.params); } catch (e) { console.error(`scenario ${id}: ${c.method} failed: ${String(e)}`); }
  }

  // dns-fail / internet-disconnect: fail every request at the Fetch stage.
  const unsubscribers: Array<() => void> = [];
  if (spec.failAllWith) {
    await sess("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
    unsubscribers.push(cdp.on("Fetch.requestPaused", async (p, sid) => {
      if (sid !== sessionId) return;
      try {
        await cdp.send("Fetch.failRequest", { requestId: p.requestId, errorReason: spec.failAllWith }, sessionId);
      } catch { /* request already gone */ }
    }));
  }

  // Capture events.
  unsubscribers.push(cdp.on("Network.loadingFailed", (p, sid) => { if (sid === sessionId) failures.push(p); }));
  unsubscribers.push(cdp.on("Runtime.consoleAPICalled", (p, sid) => { if (sid === sessionId && p.type === "error") consoleErrors.push(p); }));
  unsubscribers.push(cdp.on("Runtime.exceptionThrown", (p, sid) => { if (sid === sessionId) exceptions.push(p); }));
  unsubscribers.push(cdp.on("Target.targetCrashed", (_, sid) => { if (sid === sessionId) crashDetected = true; }));

  // Navigate + wait for load (or the failure verdict).
  let navSucceeded = false;
  let finalUrl: string | null = null;
  try {
    await sess("Page.navigate", { url });
    for (let i = 0; i < 90; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const st = await sess("Runtime.evaluate", {
        expression: `({ ready: document.readyState, url: location.href })`,
        returnByValue: true,
      });
      const v = st.result?.value as { ready?: string; url?: string } | undefined;
      if (v?.ready === "complete") { navSucceeded = true; finalUrl = v.url ?? null; break; }
      if (v?.ready && v.ready === "loading" && i > 80 && id === "offline") break; // offline never completes
    }
  } catch { /* navigation failed — that's a finding */ }

  await new Promise((r) => setTimeout(r, 1500)); // late failures (fonts/images/timers)

  // Perf + fonts + page text.
  let perf: Record<string, unknown> = {};
  try {
    const pm = await sess("Performance.getMetrics");
    const byName = Object.fromEntries((pm.metrics as Array<{ name: string; value: number }>).map((m) => [m.name, m.value]));
    const nav = await sess("Runtime.evaluate", {
      expression: `(() => { try { const n = performance.getEntriesByType("navigation")[0]; return { fcp: n ? n.responseStart : null, dcl: n ? n.domContentLoadedEventEnd : null, load: n ? n.loadEventEnd : null }; } catch { return {}; } })()`,
      returnByValue: true,
    });
    perf = { metrics: byName, nav: nav.result?.value };
  } catch { /* perf unavailable */ }
  let fonts: unknown[] = [];
  try {
    const f = await sess("Runtime.evaluate", {
      expression: `(() => { try { return [...document.fonts].map(f => ({ family: f.family, status: f.status })); } catch { return []; } })()`,
      returnByValue: true,
    });
    fonts = (f.result?.value ?? []) as unknown[];
  } catch { /* fonts unavailable */ }
  let pageTextSample: string | null = null;
  try {
    const t = await sess("Runtime.evaluate", {
      expression: `document.body ? document.body.innerText.slice(0, 2000) : null`,
      returnByValue: true,
    });
    pageTextSample = (t.result?.value as string) ?? null;
  } catch { /* no body */ }

  // Permission state query (the audit should report what the page THINKS it has).
  let permissions: Record<string, unknown> = {};
  try {
    const p = await sess("Runtime.evaluate", {
      expression: `(async () => {
        const names = ["geolocation","notifications","camera","microphone","display-capture","clipboard-read","clipboard-write","accelerometer","gyroscope","magnetometer","screen-wake-lock","local-fonts","window-management","idle-detection","persistent-storage","ambient-light-sensor"];
        const out = {};
        for (const n of names) {
          try { out[n] = (await navigator.permissions.query({ name: n })).state; } catch { out[n] = "unsupported"; }
        }
        return out;
      })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    permissions = (p.result?.value ?? {}) as Record<string, unknown>;
  } catch { /* permissions API unavailable */ }

  let screenshotPath: string | null = null;
  if (wantScreenshot) {
    try {
      const shot = await sess("Page.captureScreenshot", { format: "png" });
      screenshotPath = `${outDir}/${id}.png`;
      const b64 = shot.data as string;
      const bin = new Uint8Array(b64.length * 3 / 4);
      const str = atob(b64);
      for (let i = 0; i < str.length; i++) bin[i] = str.charCodeAt(i);
      await Deno.writeFile(screenshotPath, bin.slice(0, str.length));
    } catch { screenshotPath = null; }
  }

  for (const u of unsubscribers) u();
  await cdp.send("Target.closeTarget", { targetId: page.targetId });

  reports.push({
    scenario: id as never,
    url,
    startedAt,
    durationMs: Math.round(performance.now() - t0),
    navSucceeded,
    finalUrl,
    crashDetected,
    networkFailures: failures as never[],
    consoleErrors: consoleErrors as never[],
    uncaughtExceptions: exceptions as never[],
    perf: perf as never,
    fonts: fonts as never[],
    pageTextSample,
    screenshotPath,
    extra: { permissions },
  });
  console.log(`[${id}] nav=${navSucceeded} failures=${failures.length} consoleErrors=${consoleErrors.length} crash=${crashDetected}`);
}

const report: AuditReport = {
  url,
  engine: { chrome: "headless", cdpDomains: 57, runner: "web-resilience" },
  generatedAt: new Date().toISOString(),
  scenarios: reports,
};
const outPath = `${outDir}/audit.json`;
await Deno.writeTextFile(outPath, JSON.stringify(report, null, 2));
console.log(`wrote ${outPath}`);

await closeChrome(proc);
Deno.exit(0);
