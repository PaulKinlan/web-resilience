// audit.ts — the ONE implementation of "run a scenario against a URL".
//
// run-scenario.ts (the skill's entry point) and run-eval.ts (the scorer) both
// call this. They used to carry separate copies, which had silently diverged:
// the eval's copy dropped perf, fonts, permissions and screenshots, so the
// rubric was scoring a thinner report than the audit skill ever sees. Any
// signal added here is available to both by construction.

import { CdpClient } from "./cdpc/cdp-client.ts";
import { closeChrome, launchChrome } from "./launch.ts";
import { SCENARIOS, type Scenario } from "./scenarios.ts";
import {
  derivePlan,
  type InteractionPlan,
  runPlan,
  type Session,
  type StepResult,
  surveyDom,
} from "./interactions.ts";
import type {
  AuditReport,
  BrowserLogEntry,
  ConsoleEntry,
  FontProbe,
  NetworkFailure,
  PerfMetrics,
  ScenarioReport,
} from "./types.ts";

export interface AuditOptions {
  url: string;
  /** Scenario ids to run; defaults to the full matrix. */
  scenarios?: string[];
  outDir: string;
  screenshot?: boolean;
  /**
   * Load the page once and wait for a service worker to install before the
   * matrix runs. Without this, offline/dns scenarios test a cold cache and
   * report "no shell" for sites that do in fact have one.
   */
  prime?: boolean;
  /** Optional interaction plan driven after load, inside every scenario. */
  plan?: InteractionPlan;
  /**
   * Survey the DOM on a clean load and synthesise a plan. Ignored when an
   * explicit plan is supplied — a described or recorded flow always wins.
   */
  derivePlan?: boolean;
  onProgress?: (report: ScenarioReport) => void;
}


/** Milliseconds allowed for late failures (fonts, images, deferred timers). */
const SETTLE_MS = 1500;
const NAV_POLL_MS = 500;
const NAV_POLL_LIMIT = 90;

export async function runAudit(options: AuditOptions): Promise<AuditReport> {
  const { url, outDir } = options;
  const ids = options.scenarios ?? SCENARIOS.map((s) => s.id);
  await Deno.mkdir(outDir, { recursive: true });

  const { wsUrl, proc, binary } = await launchChrome(`${outDir}/.chrome`);
  const cdp = new CdpClient(wsUrl);
  await cdp.ready();

  const scenarios: ScenarioReport[] = [];
  try {
    if (options.prime) await primeServiceWorker(cdp, url);

    // Derive the flow on a CLEAN load. Surveying under an injected failure
    // would describe a broken DOM and produce a plan that tests nothing.
    let effective = options;
    if (!options.plan && options.derivePlan) {
      try {
        const derived = await deriveFromLiveDom(cdp, url);
        effective = { ...options, plan: derived };
        console.error(
          `derived plan "${derived.name}" with ${derived.steps.length} step(s)`,
        );
      } catch (error) {
        // Better to audit without a flow than not to audit at all.
        console.error(`could not derive a plan (${error}); continuing without one`);
      }
    }

    for (const id of ids) {
      const spec = SCENARIOS.find((s) => s.id === id);
      if (!spec) throw new Error(`unknown scenario: ${id}`);

      // One bad scenario must not cost the other 45. Losing a whole audit to a
      // stray CDP error would be a resilience bug in the resilience tool.
      let report: ScenarioReport;
      if (cdp.closed) {
        report = unrunScenario(spec, url, "browser gone before this scenario ran");
      } else {
        try {
          report = await runScenario(cdp, spec, effective);
        } catch (error) {
          report = unrunScenario(spec, url, String(error));
          console.error(`[${spec.id}] harness error: ${error}`);
        }
      }
      scenarios.push(report);
      options.onProgress?.(report);
    }
  } finally {
    cdp.close();
    await closeChrome(proc);
  }


  return {
    url,
    engine: {
      chrome: binary,
      cdpDomains: 57,
      runner: "web-resilience",
    },
    generatedAt: new Date().toISOString(),
    scenarios,
  };
}

/**
 * A scenario the harness could not complete. Emitted rather than omitted so
 * the gap is visible in the report — a missing scenario reads as "fine".
 */
function unrunScenario(
  spec: Scenario,
  url: string,
  harnessError: string,
): ScenarioReport {
  return {
    scenario: spec.id,
    url,
    startedAt: new Date().toISOString(),
    durationMs: 0,
    navSucceeded: false,
    finalUrl: null,
    crashDetected: false,
    networkFailures: [],
    consoleErrors: [],
    uncaughtExceptions: [],
    browserLogs: [],
    perf: {},
    fonts: [],
    pageTextSample: null,
    screenshotPath: null,
    harnessError,
    extra: {},
  };
}

/**
 * Load the page normally, survey its interactive surface, and synthesise a
 * plan. Runs in its own target so nothing it clicks pollutes the matrix.
 */
export async function deriveFromLiveDom(
  cdp: CdpClient,
  url: string,
): Promise<InteractionPlan> {
  const page = await cdp.send("Target.createTarget", { url });
  const { sessionId } = await cdp.send("Target.attachToTarget", {
    targetId: page.targetId,
    flatten: true,
  });
  const sess: Session = (method, params = {}) =>
    cdp.send(method, params, sessionId as string);
  try {
    await sess("Page.enable");
    await sess("Runtime.enable");
    await waitForLoad(sess);
    await sleep(500);
    const survey = await surveyDom(sess);
    return derivePlan(survey);
  } finally {
    await cdp.send("Target.closeTarget", { targetId: page.targetId }).catch(() => {});
  }
}

/**
 * Warm the origin so service-worker-backed scenarios exercise the shell.
 * Best-effort: a site without a SW just costs us one page load.
 */

export async function primeServiceWorker(cdp: CdpClient, url: string) {
  const page = await cdp.send("Target.createTarget", { url });
  const { sessionId } = await cdp.send("Target.attachToTarget", {
    targetId: page.targetId,
    flatten: true,
  });
  const sess = (method: string, params: Record<string, unknown> = {}) =>
    cdp.send(method, params, sessionId as string);
  await sess("Page.enable");
  await sess("Runtime.enable");
  await waitForLoad(sess);
  // Give install/activate a chance to finish and precache.
  await sleep(2500);
  await cdp.send("Target.closeTarget", { targetId: page.targetId });
}

export async function runScenario(
  cdp: CdpClient,
  spec: Scenario,
  options: AuditOptions,
): Promise<ScenarioReport> {
  const { url } = options;
  const networkFailures: NetworkFailure[] = [];
  const consoleErrors: ConsoleEntry[] = [];
  const uncaughtExceptions: ConsoleEntry[] = [];
  const browserLogs: BrowserLogEntry[] = [];
  const chooserEvents: Record<string, unknown>[] = [];

  let crashDetected = false;
  const startedAt = new Date().toISOString();
  const t0 = performance.now();

  let browserContextId: string | undefined;
  if (spec.incognito) {
    const ctx = await cdp.send("Target.createBrowserContext", { incognito: true });
    browserContextId = ctx.browserContextId as string;
  }
  const page = await cdp.send("Target.createTarget", {
    url: "about:blank",
    browserContextId,
  });
  const { sessionId } = await cdp.send("Target.attachToTarget", {
    targetId: page.targetId,
    flatten: true,
  });
  const sess = (method: string, params: Record<string, unknown> = {}) =>
    cdp.send(method, params, sessionId as string);

  await sess("Page.enable");
  await sess("Runtime.enable");
  await sess("Network.enable");
  await sess("Log.enable");

  // Scenario injection. %ORIGIN% resolves to the TARGET's origin, not
  // about:blank's, so permission/quota overrides land on the site under test.
  const origin = new URL(url).origin;
  const injectionErrors: string[] = [];
  for (const command of spec.commands) {
    const params = Object.fromEntries(
      Object.entries(command.params).map((
        [k, v],
      ) => [k, v === "%ORIGIN%" ? origin : v]),
    );
    try {
      await sess(command.method, params);
    } catch (error) {
      // A failed injection invalidates the scenario — record it rather than
      // reporting a clean run that never happened.
      injectionErrors.push(`${command.method}: ${String(error)}`);
    }
  }

  const unsubscribers: Array<() => void> = [];
  if (spec.failAllWith) {
    await sess("Fetch.enable", {
      patterns: [{ urlPattern: "*", requestStage: "Request" }],
    });
    unsubscribers.push(cdp.on("Fetch.requestPaused", async (p, sid) => {
      if (sid !== sessionId) return;
      try {
        await cdp.send("Fetch.failRequest", {
          requestId: p.requestId,
          errorReason: spec.failAllWith,
        }, sessionId as string);
      } catch {
        // request already gone
      }
    }));
  }

  const mine = (sid?: string) => sid === sessionId;

  // Network.loadingFailed identifies the request only by requestId, so keep a
  // requestId → url/type index from requestWillBeSent to resolve it.
  const requested = new Map<string, { url: string | null; type: string | null }>();
  unsubscribers.push(
    cdp.on("Network.requestWillBeSent", (p, sid) => {
      if (!mine(sid)) return;
      const request = p.request as { url?: string } | undefined;
      requested.set(String(p.requestId), {
        url: request?.url ?? null,
        type: (p.type as string) ?? null,
      });
    }),
    cdp.on("Network.loadingFailed", (p, sid) => {
      if (!mine(sid)) return;
      const origin = requested.get(String(p.requestId));
      networkFailures.push({
        ...p,
        url: origin?.url ?? null,
        resourceType: (p.type as string) ?? origin?.type ?? null,
        errorText: (p.errorText as string) ?? null,
        canceled: Boolean(p.canceled),
        blockedReason: (p.blockedReason as string) ?? null,
      });
    }),

    cdp.on("Runtime.consoleAPICalled", (p, sid) => {
      if (mine(sid) && p.type === "error") consoleErrors.push(p);
    }),
    cdp.on("Runtime.exceptionThrown", (p, sid) => {
      if (mine(sid)) uncaughtExceptions.push(p);
    }),
    // Log.enable was already called but nothing listened, so every
    // browser-generated diagnostic was discarded. CSP violations in
    // particular are reported ONLY here.
    cdp.on("Log.entryAdded", (p, sid) => {
      if (mine(sid) && p.entry) browserLogs.push(p.entry as BrowserLogEntry);
    }),
    cdp.on("Target.targetCrashed", (_p, sid) => {
      if (mine(sid)) crashDetected = true;
    }),
  );

  if (spec.id === "file-picker") {
    unsubscribers.push(cdp.on("Page.fileChooserOpened", (p, sid) => {
      if (mine(sid)) chooserEvents.push(p);
    }));
  }

  let navSucceeded = false;
  let finalUrl: string | null = null;
  try {
    await sess("Page.navigate", { url });
    const loaded = await waitForLoad(sess, spec.id === "offline");
    navSucceeded = loaded.complete;
    finalUrl = loaded.url;
  } catch {
    // Navigation failure IS the finding for several scenarios.
  }

  await sleep(SETTLE_MS);

  // Run the flow with damage attribution: snapshot the failure counters after
  // each step so "clicking Checkout killed 3 requests" is recoverable from the
  // report, not just "the flow failed somewhere".
  let interactions: unknown = null;
  if (options.plan) {
    let seenFailures = 0;
    let seenErrors = 0;
    const damage: Record<number, { networkFailures: number; consoleErrors: number }> = {};
    const planResult = await runPlan(sess, options.plan, {
      onStepComplete: (step: StepResult) => {
        damage[step.index] = {
          networkFailures: networkFailures.length - seenFailures,
          consoleErrors: consoleErrors.length - seenErrors,
        };
        seenFailures = networkFailures.length;
        seenErrors = consoleErrors.length;
      },
    });
    interactions = {
      ...planResult,
      steps: planResult.steps.map((step) => ({ ...step, ...damage[step.index] })),
    };
  }


  const perf = await capturePerf(sess);
  const fonts = await captureFonts(sess);
  const pageTextSample = await captureText(sess);
  const permissions = await capturePermissions(sess);
  const screenshotPath = options.screenshot
    ? await captureScreenshot(sess, `${options.outDir}/${spec.id}.png`)
    : null;

  for (const unsubscribe of unsubscribers) unsubscribe();
  await cdp.send("Target.closeTarget", { targetId: page.targetId }).catch(() => {});
  if (browserContextId) {
    await cdp.send("Target.disposeBrowserContext", { browserContextId }).catch(
      () => {},
    );
  }

  return {
    scenario: spec.id,
    url,
    startedAt,
    durationMs: Math.round(performance.now() - t0),
    navSucceeded,
    finalUrl,
    crashDetected,
    networkFailures,
    consoleErrors,
    uncaughtExceptions,
    browserLogs,
    perf,
    fonts,
    pageTextSample,
    screenshotPath,
    extra: { permissions, chooserEvents, injectionErrors, interactions },
  };

}


async function waitForLoad(
  sess: Session,
  allowIncomplete = false,
): Promise<{ complete: boolean; url: string | null }> {
  for (let i = 0; i < NAV_POLL_LIMIT; i++) {
    await sleep(NAV_POLL_MS);
    try {
      const state = await sess("Runtime.evaluate", {
        expression: `({ ready: document.readyState, url: location.href })`,
        returnByValue: true,
      });
      const value = (state.result as { value?: { ready?: string; url?: string } })
        ?.value;
      if (value?.ready === "complete") {
        return { complete: true, url: value.url ?? null };
      }
      // Offline never reaches `complete`; don't burn the full 45s on it.
      if (allowIncomplete && value?.ready === "loading" && i > 20) break;
    } catch {
      // Target may be gone (crash scenarios) — treat as incomplete.
      break;
    }
  }
  return { complete: false, url: null };
}


async function capturePerf(sess: Session): Promise<PerfMetrics> {
  try {
    const pm = await sess("Performance.getMetrics");
    const metrics = Object.fromEntries(
      (pm.metrics as Array<{ name: string; value: number }>).map((
        m,
      ) => [m.name, m.value]),
    );
    const nav = await sess("Runtime.evaluate", {
      expression:
        `(() => { try { const n = performance.getEntriesByType("navigation")[0]; return n ? { fcp: n.responseStart, dcl: n.domContentLoadedEventEnd, load: n.loadEventEnd } : null; } catch { return null; } })()`,
      returnByValue: true,
    });
    return {
      metrics,
      nav: ((nav.result as { value?: PerfMetrics["nav"] })?.value) ?? null,
    };
  } catch {
    return {};
  }
}

async function captureFonts(sess: Session): Promise<FontProbe[]> {
  try {
    const fonts = await sess("Runtime.evaluate", {
      expression:
        `(() => { try { return [...document.fonts].map(f => ({ family: f.family, status: f.status })); } catch { return []; } })()`,
      returnByValue: true,
    });
    return ((fonts.result as { value?: FontProbe[] })?.value ?? []);
  } catch {
    return [];
  }
}


async function captureText(sess: Session): Promise<string | null> {
  try {
    const text = await sess("Runtime.evaluate", {
      expression: `document.body ? document.body.innerText.slice(0, 2000) : null`,
      returnByValue: true,
    });
    return ((text.result as { value?: string })?.value ?? null);
  } catch {
    return null;
  }
}

const PERMISSION_NAMES = [
  "geolocation",
  "notifications",
  "camera",
  "microphone",
  "display-capture",
  "clipboard-read",
  "clipboard-write",
  "accelerometer",
  "gyroscope",
  "magnetometer",
  "screen-wake-lock",
  "local-fonts",
  "window-management",
  "idle-detection",
  "persistent-storage",
  "ambient-light-sensor",
];

async function capturePermissions(
  sess: Session,
): Promise<Record<string, unknown>> {
  try {
    const result = await sess("Runtime.evaluate", {
      expression: `(async () => {
        const names = ${JSON.stringify(PERMISSION_NAMES)};
        const out = {};
        for (const n of names) {
          try { out[n] = (await navigator.permissions.query({ name: n })).state; }
          catch { out[n] = "unsupported"; }
        }
        return out;
      })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    return ((result.result as { value?: Record<string, unknown> })?.value ??
      {}) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function captureScreenshot(
  sess: Session,
  path: string,
): Promise<string | null> {
  try {
    const shot = await sess("Page.captureScreenshot", { format: "png" });
    const binary = atob(shot.data as string);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    await Deno.writeFile(path, bytes);
    return path;
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
