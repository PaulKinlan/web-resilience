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
  InjectionCheck,
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

  // Chrome is mutable state here because it can die mid-matrix and we relaunch
  // it. A crash 22 scenarios in used to silently cost the remaining 24 — and
  // the eval still scored the run as a pass, because the rubric's findings all
  // happened to live in the scenarios that did run.
  let { wsUrl, proc, binary } = await launchChrome(`${outDir}/.chrome`);
  let cdp = new CdpClient(wsUrl);
  await cdp.ready();
  let relaunches = 0;
  const MAX_RELAUNCHES = 3;

  /** Replace a dead browser. Returns false once we stop trying. */
  const relaunch = async (): Promise<boolean> => {
    if (relaunches >= MAX_RELAUNCHES) return false;
    relaunches++;
    console.error(`chrome died; relaunching (${relaunches}/${MAX_RELAUNCHES})`);
    try {
      cdp.close();
    } catch { /* already gone */ }
    await closeChrome(proc);
    // A fresh profile dir: the old one may be what killed it, and a reused
    // dir would also resurrect any service worker the matrix just cleared.
    const next = await launchChrome(`${outDir}/.chrome-${relaunches}`);
    proc = next.proc;
    binary = next.binary;
    cdp = new CdpClient(next.wsUrl);
    await cdp.ready();
    return true;
  };

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

      if (cdp.closed && !await relaunch()) {
        scenarios.push(unrunScenario(spec, url, "browser gone and relaunch limit reached"));
        options.onProgress?.(scenarios[scenarios.length - 1]);
        continue;
      }

      // One bad scenario must not cost the other 45. Losing a whole audit to a
      // stray CDP error would be a resilience bug in the resilience tool.
      //
      // Two attempts, and only two: the scenario that kills the browser is
      // usually the one worth having (tab-crash takes the browser-level socket
      // down with it), so retry it once on the fresh browser. If it dies again
      // it is genuinely unrunnable here and we record the gap rather than
      // looping on it.
      let report: ScenarioReport | null = null;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          report = await runScenario(cdp, spec, effective);
          break;
        } catch (error) {
          console.error(`[${spec.id}] harness error: ${error}`);
          // Relaunch on any transport death, whether or not we intend to
          // retry — the next scenario needs a browser either way.
          const revived = cdp.closed ? await relaunch() : true;
          // Retry on ANY first-attempt failure, not just a dead socket. The
          // narrower condition looked prudent and was not: an `after-load`
          // scenario whose setup navigation was merely slow throws with the
          // socket perfectly healthy, so the retry never fired and the
          // scenario was written off as unrun. A flaky load should cost a few
          // seconds, not a hole in the matrix.
          if (attempt === 1 && revived) {
            console.error(`[${spec.id}] retrying`);
            continue;
          }
          report = unrunScenario(spec, url, String(error));
          break;
        }
      }
      scenarios.push(report!);
      options.onProgress?.(report!);
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
    perf: emptyPerf(),
    fonts: [],
    pageTextSample: null,
    screenshotPath: null,
    // The scenario never ran, so the failure was certainly not injected.
    // Saying so explicitly keeps `refuted` meaning "we tried and it did not
    // take", which is a different and much more interesting problem.
    injection: { status: "refuted", detail: harnessError },
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
  await sess("Performance.enable");
  // Register before navigation: paint/shift entries can precede our first poll.
  await sess("Page.addScriptToEvaluateOnNewDocument", {
    source: `(() => {
      const vitals = globalThis.__webResilienceVitals = { lcp: null, cls: null };
      try {
        new PerformanceObserver(list => {
          const entries = list.getEntries();
          if (entries.length) vitals.lcp = entries[entries.length - 1].startTime;
        }).observe({ type: "largest-contentful-paint", buffered: true });
      } catch { /* unsupported: keep null rather than invent a measurement */ }
      try {
        if (PerformanceObserver.supportedEntryTypes.includes("layout-shift")) {
          new PerformanceObserver(list => {
            for (const entry of list.getEntries()) {
              if (!entry.hadRecentInput) vitals.cls += entry.value;
            }
          }).observe({ type: "layout-shift", buffered: true });
          vitals.cls = 0;
        }
      } catch { /* unsupported: keep null, distinct from measured zero */ }
    })()`,
  });

  // Scenario injection. %ORIGIN% resolves to the TARGET's origin, not
  // about:blank's, so permission/quota overrides land on the site under test.
  //
  // Deliberately a function, not a loop run here: the listeners below must be
  // attached FIRST. They used to be wired up after injection, so any event the
  // injection itself provoked — the renderer crash, most obviously — landed
  // before anything was listening and was lost.
  const origin = new URL(url).origin;
  const injectionErrors: string[] = [];
  const inject = async () => {
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
  };

  const unsubscribers: Array<() => void> = [];

  // A service worker is a SEPARATE CDP target with its own network stack.
  // Network.emulateNetworkConditions and Fetch interception applied to the
  // page session do not touch it. The consequence was severe and completely
  // silent: on any service-worker-backed site the `offline` scenario was not
  // offline at all. The worker intercepted each fetch, went to the real
  // network, and served a live response — so the audit reported a site
  // "surviving offline" that had never been taken offline. `offline` and
  // `dns-fail` were inert on exactly the class of site people build service
  // workers FOR.
  //
  // Auto-attach picks the worker up whenever it spins up (it starts lazily,
  // so attaching once up front is not enough) and we replay the scenario's
  // network commands into it.
  const workerSessions = new Set<string>();
  const shapesNetwork = (method: string) => method.startsWith("Network.");

  const applyToWorker = async (wsid: string) => {
    if (workerSessions.has(wsid)) return; // auto-attach and enumeration overlap
    workerSessions.add(wsid);
    try {
      await cdp.send("Network.enable", {}, wsid);
      for (const command of spec.commands) {
        if (!shapesNetwork(command.method)) continue; // Emulation.* is page-only
        await cdp.send(command.method, command.params, wsid).catch(() => {});
      }
      if (spec.failAllWith) {
        // Deliberately NOT Fetch interception. Enabling Fetch on a service
        // worker session wedges the worker for the remainder of the browser's
        // life: `dns-fail` poisoned every single scenario that followed it,
        // and because the cached shell still rendered, the damage showed up
        // as `navSucceeded: false` with plausible-looking page text — a
        // harness fault wearing the costume of a finding.
        //
        // Offline emulation gets us what the scenario actually needs: the
        // worker's own `fetch()` rejects, so cache fallbacks are exercised.
        // The cost is honest and small — the worker sees a generic transport
        // failure instead of the specific `errorReason`. Nothing in the
        // matrix distinguishes worker-side error codes, and a slightly
        // coarser failure beats a scenario that lies.
        await cdp.send("Network.emulateNetworkConditions", {
          offline: true,
          latency: 0,
          downloadThroughput: 0,
          uploadThroughput: 0,
          connectionType: "none",
        }, wsid).catch(() => {});
      }
      if (Deno.env.get("WR_DEBUG_WORKERS")) {
        console.error(`[${spec.id}] shaped worker session ${wsid}`);
      }
    } catch {
      // The worker can die or never start; that is not a scenario failure.
    }
  };

  // Attaching per scenario is only safe if we also DETACH per scenario. The
  // page target is thrown away at the end of each scenario, which is what
  // makes page-level overrides self-cleaning — but the service worker
  // outlives every scenario in the matrix. An override left on it (offline,
  // blocked URLs, throttling) would silently apply to all 45 runs that
  // follow, and the fixture would look progressively more broken the further
  // down the matrix you read.
  const releaseWorkers = async () => {
    for (const wsid of workerSessions) {
      await cdp.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: 0,
        downloadThroughput: 0,
        uploadThroughput: 0,
        connectionType: "none",
      }, wsid).catch(() => {});
      await cdp.send("Network.setBlockedURLs", { urls: [] }, wsid).catch(
        () => {},
      );
      await cdp.send("Network.disable", {}, wsid).catch(() => {});
      await cdp.send("Target.detachFromTarget", { sessionId: wsid }).catch(
        () => {},
      );
    }
    workerSessions.clear();
  };

  let cleanedUp = false;
  const cleanup = async () => {
    if (cleanedUp) return;
    cleanedUp = true;
    for (const unsubscribe of unsubscribers) unsubscribe();
    await releaseWorkers();
    await cdp.send("Target.closeTarget", { targetId: page.targetId }).catch(
      () => {},
    );
    if (browserContextId) {
      await cdp.send("Target.disposeBrowserContext", { browserContextId })
        .catch(() => {});
    }
  };

  unsubscribers.push(cdp.on("Target.attachedToTarget", (p) => {
    const info = p.targetInfo as { type?: string } | undefined;
    if (info?.type !== "service_worker" && info?.type !== "worker") return;
    void applyToWorker(p.sessionId as string);
  }));
  // Browser-level: service workers are not children of the page target, so a
  // page-scoped auto-attach never sees them.
  await cdp.send("Target.setAutoAttach", {
    autoAttach: true,
    waitForDebuggerOnStart: false,
    flatten: true,
  }).catch(() => {});

  // Auto-attach only fires for targets created AFTER it is set. The service
  // worker is registered during priming and then outlives every scenario in
  // the matrix, so it already exists here and no event ever arrives for it.
  // That is exactly the worker we need to shape, so enumerate and attach.
  try {
    const { targetInfos } = await cdp.send("Target.getTargets") as {
      targetInfos: Array<{ targetId: string; type: string; url: string }>;
    };
    for (const info of targetInfos ?? []) {
      if (info.type !== "service_worker" && info.type !== "worker") continue;
      // Only workers belonging to the site under test.
      if (info.url && !info.url.startsWith(origin)) continue;
      const attached = await cdp.send("Target.attachToTarget", {
        targetId: info.targetId,
        flatten: true,
      }).catch(() => null);
      if (attached?.sessionId) await applyToWorker(attached.sessionId as string);
    }
  } catch {
    // Target enumeration is best-effort; a site with no worker is the norm.
  }

  if (spec.failAllWith) {
    await sess("Fetch.enable", {
      patterns: [{ urlPattern: "*", requestStage: "Request" }],
    });
    unsubscribers.push(cdp.on("Fetch.requestPaused", async (p, sid) => {
      // Page session only. Workers are shaped with offline emulation instead
      // (see applyToWorker) because Fetch interception is not survivable on a
      // target that outlives the scenario.
      if (sid !== sessionId) return;
      try {
        await cdp.send("Fetch.failRequest", {
          requestId: p.requestId,
          errorReason: spec.failAllWith,
        }, sid as string);
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
    // Crash detection listens on BOTH events, because they are scoped
    // differently and neither alone is sufficient:
    //   Inspector.targetCrashed — session-scoped, arrives with our sessionId.
    //   Target.targetCrashed    — browser-scoped, arrives with NO sessionId
    //                             and must be matched on targetId instead.
    // This used to be a lone `Target.targetCrashed` behind a `mine(sid)`
    // guard, which is unsatisfiable: a browser-scoped event has no session,
    // so crashDetected was false on every run of every scenario.
    cdp.on("Inspector.targetCrashed", (_p, sid) => {
      if (mine(sid)) crashDetected = true;
    }),
    cdp.on("Target.targetCrashed", (p, _sid) => {
      if (p.targetId === page.targetId) crashDetected = true;
    }),
  );

  if (spec.id === "file-picker") {
    unsubscribers.push(cdp.on("Page.fileChooserOpened", (p, sid) => {
      if (mine(sid)) chooserEvents.push(p);
    }));
  }

  const phase = spec.phase ?? "before-load";

  // before-load is the common case: the failure has to be in force while the
  // page loads, or it is not the failure we meant to test.
  if (phase === "before-load") await inject();

  let navSucceeded = false;
  let finalUrl: string | null = null;
  const navigate = async (tolerateFailure: boolean) => {
    try {
      await sess("Page.navigate", { url });
      const loaded = await waitForLoad(sess, tolerateFailure);
      navSucceeded = loaded.complete;
      finalUrl = loaded.url;
    } catch {
      // Navigation failure IS the finding for several scenarios.
      navSucceeded = false;
    }
  };

  await navigate(spec.id === "offline");
  await sleep(SETTLE_MS);

  if (phase === "after-load") {
    // The setup load is a PRECONDITION, not a measurement. If it failed we are
    // still sitting on about:blank, and injecting here would be actively
    // harmful on two counts:
    //
    //  1. It tests nothing — crashing a blank page then loading the site
    //     cleanly is the exact bug this phase split exists to fix.
    //  2. It kills the browser. about:blank shares a renderer process with
    //     Chrome's own startup tab, so Page.crash against it takes down the
    //     last renderer and the browser exits. This is the "chrome died"
    //     that has been eating scenarios all along: a slow first navigation
    //     times out, the crash lands on about:blank, and the process dies.
    //
    // Throwing hands this to the retry path, which relaunches and tries once
    // more on a clean browser — far better than recording nav=false, which
    // would read as a genuine finding ("the app failed to load") when it is
    // really just harness damage.
    if (!navSucceeded) {
      // Release this scenario's CDP state first. Throwing past the teardown
      // would leave worker sessions attached, and a leaked worker session is
      // not inert — see the cleanup comment below.
      await cleanup();
      throw new Error(
        `${spec.id}: setup load failed, so the failure was never injected ` +
          `(refusing to crash about:blank — it would take the browser with it)`,
      );
    }

    // The app is up. NOW break it, and re-navigate to find out whether it can
    // come back. navSucceeded/finalUrl are deliberately overwritten by this
    // second navigation: for a recovery scenario, recovery is the result that
    // matters, not the clean load that set it up.
    await inject();
    await sleep(500);
    await navigate(false);
    await sleep(SETTLE_MS);
  }

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

  // Deliberately last. The probe is allowed to be expensive (the CPU ones burn
  // millions of iterations) and mildly mutating (the cookie one writes a
  // cookie), which is only safe once every measurement above is already
  // banked. A verification step that perturbs the thing it is verifying is
  // worse than no verification at all.
  const injection = await verifyInjection(sess, spec);

  await cleanup();

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
    injection,
    extra: { permissions, chooserEvents, injectionErrors, interactions },
  };

}


/**
 * Ask the page whether the scenario's failure was actually in force.
 *
 * The expression is wrapped in an async IIFE so probes can `await` (the
 * storage ones need `navigator.storage.estimate()`), and evaluated with
 * `returnByValue` so the verdict comes back as a plain boolean rather than a
 * remote object handle.
 *
 * A probe that throws is reported as `error`, never as `refuted`. The
 * distinction matters: `refuted` is an accusation against the harness and
 * should be actionable, so it has to mean "the page told us the failure is not
 * in force", not "we could not ask". A page that is offline, crashed, or has
 * no JS execution context at all will fail every probe, and none of those are
 * evidence that the injection missed.
 */
export async function verifyInjection(
  sess: Session,
  spec: Scenario,
): Promise<InjectionCheck> {
  if (spec.unsupported) {
    return { status: "unsupported", detail: spec.unsupported, requires: spec.requires };
  }
  if (!spec.verify) {
    return { status: "unverified", requires: spec.requires };
  }
  try {
    const res = await sess("Runtime.evaluate", {
      expression: `(async () => { return (${spec.verify}); })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    const exception = (res as { exceptionDetails?: { text?: string } }).exceptionDetails;
    if (exception) {
      return {
        status: "error",
        expression: spec.verify,
        detail: exception.text ?? "probe threw",
        requires: spec.requires,
      };
    }
    const value = (res.result as { value?: unknown })?.value;
    return {
      status: value === true ? "confirmed" : "refuted",
      expression: spec.verify,
      value,
      requires: spec.requires,
    };
  } catch (err) {
    return {
      status: "error",
      expression: spec.verify,
      detail: err instanceof Error ? err.message : String(err),
      requires: spec.requires,
    };
  }
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


function emptyPerf(): PerfMetrics {
  return {
    metrics: {},
    nav: { fcp: null, lcp: null, cls: null, dcl: null, load: null },
    fcpMs: null,
    lcpMs: null,
    cls: null,
    domContentLoadedMs: null,
    loadMs: null,
  };
}

export async function capturePerf(sess: Session): Promise<PerfMetrics> {
  try {
    const pm = await sess("Performance.getMetrics");
    const metrics = Object.fromEntries(
      (pm.metrics as Array<{ name: string; value: number }>).map((
        m,
      ) => [m.name, m.value]),
    );
    const result = await sess("Runtime.evaluate", {
      expression: `(() => {
        const n = performance.getEntriesByType("navigation")[0];
        const vitals = globalThis.__webResilienceVitals;
        return {
          fcp: performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? null,
          lcp: vitals?.lcp ?? null,
          cls: vitals?.cls ?? null,
          dcl: n?.domContentLoadedEventEnd ?? null,
          load: n?.loadEventEnd ?? null,
        };
      })()`,
      returnByValue: true,
    });
    const nav = (result.result as { value?: PerfMetrics["nav"] })?.value;
    if (!nav) return emptyPerf();
    return {
      metrics,
      nav,
      fcpMs: nav.fcp,
      lcpMs: nav.lcp,
      cls: nav.cls,
      domContentLoadedMs: nav.dcl,
      loadMs: nav.load,
    };
  } catch {
    return emptyPerf();
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
