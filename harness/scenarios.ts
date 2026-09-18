// scenarios.ts — the failure-injection matrix as harness-side CDP commands.
// Each scenario is a list of {method, params} applied to the page session,
// plus an optional request-pause policy (dns-fail).
//
// Injection happens BEFORE navigation by default, because most failures only
// mean something if they are in force while the page loads. A few scenarios
// are the opposite: see `phase`.

export type CdpCommand = { method: string; params: Record<string, unknown> };

/**
 * When to apply a scenario's commands.
 *
 * - `before-load` (default): inject, then navigate. Correct for anything that
 *   shapes the load itself — offline, blocked resources, throttling.
 * - `after-load`: navigate, let the app settle, THEN inject and re-navigate.
 *   Correct for recovery tests, where the whole question is what happens to a
 *   running app. Crashing about:blank and then loading the site cleanly, which
 *   is what `before-load` would do, tests nothing at all.
 */
export type ScenarioPhase = "before-load" | "after-load";

export interface ScenarioSpec {
  id: string;
  label: string;
  description: string;
  commands: CdpCommand[];
  /** When set, the harness intercepts requests and fails them with this errorReason. */
  failAllWith?: "NameNotResolved" | "InternetDisconnected" | "TimedOut" | "ConnectionRefused" | "BlockedByClient";
  /** Run the target in an incognito browser context (partitioned storage). */
  incognito?: boolean;
  /** Defaults to `before-load`. */
  phase?: ScenarioPhase;
  /**
   * A JS expression, evaluated in the page after measurement, that must be
   * truthy if the injection actually took effect.
   *
   * This exists because a scenario that silently fails to inject is
   * indistinguishable from a site that shrugged the failure off — and the
   * harness scores the second as a pass. `wr inert` found 22 scenarios whose
   * output is byte-identical to baseline on every fixture; without a probe
   * like this there is no way to tell which of those are the site being
   * robust and which are us doing nothing at all.
   *
   * Two rules for anything written here:
   *
   *  1. It must be PASSIVE. No fetches, no navigation, no DOM mutation that
   *     outlives the read. The probe is not allowed to become part of the
   *     measurement it is checking.
   *  2. It must read the thing the scenario claims to change, not a
   *     downstream consequence of it. `hardwareConcurrency === 1` is a proof;
   *     "the page got slower" is a guess.
   *
   * Runs after perf/text/font capture, so a probe that burns CPU is fine.
   * `await` is allowed — the expression is evaluated as an async IIFE body.
   */
  verify?: string;
  /**
   * A page capability this scenario needs in order to be able to show
   * anything at all, in plain words.
   *
   * `websocket-drop` cannot produce a finding against a page that never opens
   * a WebSocket, and that is a gap in the FIXTURES, not a bug in the
   * scenario. Recording it here is what separates "this injection is broken"
   * from "nothing we test has ever exercised this", which are the same
   * symptom and completely different fixes.
   */
  requires?: string;
  /**
   * Set when the failure cannot honestly be injected with CDP at all. The
   * scenario still runs and still reports, but it reports `unsupported`
   * rather than quietly passing.
   *
   * A scenario that cannot fail is worse than a missing scenario: it is a
   * permanent free point on the scoreboard.
   */
  unsupported?: string;
}

interface ScenarioOptions {
  failAllWith?: ScenarioSpec["failAllWith"];
  incognito?: boolean;
  phase?: ScenarioPhase;
  verify?: string;
  requires?: string;
  unsupported?: string;
}

// The generic <Id> keeps each scenario's id as a literal type, which is what
// lets ScenarioId in types.ts be derived from this matrix rather than
// hand-maintained (it had drifted to 17 of 46 ids).
//
// Every key is listed explicitly rather than spread from `opts`, so that each
// member of the SCENARIOS union has the same shape. Spreading would leave
// scenarios without options missing the keys entirely, and `.phase` on the
// union would stop compiling.
const S = <const Id extends string>(
  id: Id,
  label: string,
  description: string,
  commands: CdpCommand[],
  opts: ScenarioOptions = {},
) => ({
  id,
  label,
  description,
  commands,
  failAllWith: opts.failAllWith,
  incognito: opts.incognito,
  phase: opts.phase,
  verify: opts.verify,
  requires: opts.requires,
  unsupported: opts.unsupported,
});

/**
 * A `verify` expression that times a fixed unit of work and asserts it took at
 * least `floorMs`.
 *
 * CPU throttling is invisible to JS: there is no `navigator.cpuThrottled`, and
 * the emulation changes no observable state, only the rate at which the
 * renderer executes. Timing a known workload is the only page-side proof
 * available.
 *
 * The floors are set well below the nominal throttling multiple on purpose.
 * The claim being checked is "the CPU is demonstrably slower than an unthrottled
 * one", which is what the scenario asserts. Checking for a precise 6x or 20x
 * would be an assertion about the speed of the machine running the audit, and
 * would go red on fast hardware for no useful reason.
 */
const CPU_SLOWER_THAN = (floorMs: number) =>
  `(() => {
    const t0 = performance.now();
    let acc = 0;
    for (let i = 0; i < 8e6; i++) acc += Math.sqrt(i);
    return acc >= 0 && performance.now() - t0 >= ${floorMs};
  })()`;

/**
 * A `verify` expression that tries to write `chunks` × 256KB into the Cache API
 * and asserts the write was refused for quota reasons.
 *
 * Reading `navigator.storage.estimate().quota` seemed like the obvious probe
 * and is wrong: with a 1MB override actively rejecting writes, estimate() still
 * cheerfully reports the full ~10GB default. The reported quota and the
 * enforced quota are different numbers, and only one of them is the one the
 * scenario claims to change.
 *
 * Deletes its cache on the way out. This runs after capture, but the browser
 * profile is shared by every later scenario in the run, and leaving several MB
 * of probe data behind would change the storage conditions they execute under.
 */
const QUOTA_REJECTS_WRITE_OF = (chunks: number) =>
  `(async () => {
    const name = "wr-quota-probe";
    try {
      const cache = await caches.open(name);
      const chunk = new Uint8Array(262144);
      for (let i = 0; i < ${chunks}; i++) {
        await cache.put("/wr-quota-probe-" + i, new Response(chunk));
      }
      return false;
    } catch (e) {
      return e instanceof Error && e.name === "QuotaExceededError";
    } finally {
      try { await caches.delete(name); } catch { /* nothing to clean up */ }
    }
  })()`;

export const SCENARIOS = [

  S("baseline", "Baseline (no failure injected)", "Normal load — the control run.", [
    { method: "Network.emulateNetworkConditions", params: { offline: false, latency: 0, downloadThroughput: 0, uploadThroughput: 0, connectionType: "none" } },
  ]),
  S("offline", "Fully offline", "The whole page must fail to load; surviving behavior (cache/SW) is the finding.", [
    { method: "Network.emulateNetworkConditions", params: { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0, connectionType: "none" } },
  ]),
  S("dns-fail", "DNS interception (Great Firewall style)", "Every request fails with NameNotResolved — simulates DNS being poisoned/blocked.", [], { failAllWith: "NameNotResolved" }),
  S("block-js", "Block all JavaScript", "Main scripts fail — tests defensive init, noscript, progressive enhancement.", [
    { method: "Network.setBlockedURLs", params: { urls: ["*.js"] } },
  ]),
  S("block-css", "Block all stylesheets", "CSS fails — tests content usability without styles.", [
    { method: "Network.setBlockedURLs", params: { urls: ["*.css"] } },
  ]),
  S("block-fonts", "Block webfonts", "Fonts fail — tests font-display behavior, fallback stacks, FOIT/FOUT.", [
    { method: "Network.setBlockedURLs", params: { urls: ["*.woff2", "*.woff", "*.ttf", "*.otf"] } },
  ], {
    requires:
      "a webfont served from a host that actually resolves. Every fixture links fonts.example.invalid, so the font fails at baseline too and document.fonts is empty in every run — blocking it changes nothing.",
  }),
  // No `verify` here, and that is a deliberate conclusion rather than an
  // omission.
  //
  // The obvious probe, `navigator.connection.rtt`, is useless: under CDP the
  // Network Information API is pinned to its defaults and reports rtt=50,
  // effectiveType="4g" no matter what is emulated. A probe reading it would
  // refute every throttling run and send someone chasing a bug that is not
  // there.
  //
  // The injection is sound. Measured directly, with the service worker
  // bypassed and the cache busted, document navigation on the reference
  // fixture takes 120ms unthrottled, 845ms on slow-4G and 3306ms on 2G.
  //
  // The reason there is still no probe is that the honest proof — "some
  // request was slow" — is unavailable on exactly the sites that matter most
  // here. A precached app serves its shell from the service worker and never
  // touches the network, so nothing is slow, and that is the app being good
  // rather than the harness being broken.
  S("throttled-slow", "Throttled (slow 4G)", "400ms RTT, 1.6 Mbps down — assets starve, LCP/fonts suffer.", [
    { method: "Network.emulateNetworkConditions", params: { offline: false, latency: 400, downloadThroughput: 200000, uploadThroughput: 100000, connectionType: "cellular3g" } },
  ], {
    requires:
      "a load that actually uses the network, plus timing-sensitive capture. A fully precached app is unaffected by network conditions by design, and perf is excluded from the inertness fingerprint because it is noisy.",
  }),
  S("throttled-2g", "Throttled (2G)", "1500ms RTT, 250 Kbps down — the extreme case.", [
    { method: "Network.emulateNetworkConditions", params: { offline: false, latency: 1500, downloadThroughput: 30000, uploadThroughput: 15000, connectionType: "cellular2g" } },
  ], {
    requires:
      "a load that actually uses the network, plus timing-sensitive capture. See throttled-slow.",
  }),
  // Fixed work, measured wall-clock. The threshold is deliberately a fraction
  // of the throttling rate: this asks "is the CPU demonstrably slower", not
  // "is it slower by exactly 6x", which would be a flaky assertion about the
  // machine running the audit rather than about the injection.
  S("cpu-6x", "CPU throttled 6x", "Low-end device CPU — long tasks, INP, jank.", [
    { method: "Emulation.setCPUThrottlingRate", params: { rate: 6 } },
  ], { verify: CPU_SLOWER_THAN(20) }),
  S("cpu-20x", "CPU throttled 20x", "Extreme low-end — interaction responsiveness.", [
    { method: "Emulation.setCPUThrottlingRate", params: { rate: 20 } },
  ], { verify: CPU_SLOWER_THAN(80) }),
  // This used to suppress pressure notifications and then send one, which is
  // a null operation with extra steps: setPressureNotificationsSuppressed
  // turns OFF delivery to the renderer, so the simulated notification the
  // next line sends was guaranteed never to arrive. It also ran before-load,
  // against a page that did not exist yet. Both are fixed: deliver the
  // notification, and deliver it to a running app.
  S("memory-critical", "Memory pressure (critical)", "Simulates low-memory devices; browsers may discard pages/tabs.", [
    { method: "Memory.setPressureNotificationsSuppressed", params: { suppressed: false } },
    { method: "Memory.simulatePressureNotification", params: { level: "critical" } },
  ], { phase: "after-load" }),
  // after-load: crashing about:blank and then loading the site cleanly would
  // exercise nothing. The renderer has to die with the app running in it.
  S("tab-crash", "Renderer crash + reload", "Page.crash then reload — tests crash recovery, state preservation.", [
    { method: "Page.crash", params: {} },
  ], { phase: "after-load" }),
  // The description always said "freeze then resume". The scenario did
  // neither usefully: it froze about:blank before the site had loaded, and
  // never resumed, so nothing in the app ever saw a freeze or a resume.
  S("backgrounded", "Frozen/backgrounded", "Freeze then resume — timers, persistence, visibility handling.", [
    { method: "Page.setWebLifecycleState", params: { state: "frozen" } },
    { method: "Page.setWebLifecycleState", params: { state: "active" } },
  ], { phase: "after-load" }),
  S("no-cache", "No cache / cold start", "Cache disabled — the true first-load cost.", [
    { method: "Network.setCacheDisabled", params: { cacheDisabled: true } },
  ], {
    requires:
      "a page whose repeat-visit behaviour differs from its first visit. The fixtures are small and served fresh, so a cold start looks identical to a warm one.",
  }),
  // quotaSize was 0, which CDP reads as "no override" — so the scenario named
  // "storage quota exhausted" was granting the origin the full default quota.
  // Measured: with quotaSize 0 a 4MB cache write succeeds; with a real limit
  // it rejects with QuotaExceededError. One byte is the smallest honest way
  // to say "none".
  S("storage-quota", "Storage quota exhausted", "IndexedDB/localStorage writes fail — tests quota-aware persistence.", [
    { method: "Storage.overrideQuotaForOrigin", params: { origin: "%ORIGIN%", quotaSize: 1 } },
  ], { verify: QUOTA_REJECTS_WRITE_OF(2) }),

  S("hardware-concurrency", "Hardware concurrency = 1", "Single-core device — worker/pool assumptions.", [
    { method: "Emulation.setHardwareConcurrencyOverride", params: { hardwareConcurrency: 1 } },
  ], { verify: `navigator.hardwareConcurrency === 1` }),
  S("mobile", "Mobile device (UA + touch + small viewport)", "The low-end phone environment: touch interaction, small screen, mobile UA.", [
    { method: "Emulation.setUserAgentOverride", params: { userAgent: "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36", platform: "Android", mobile: true } },
    { method: "Emulation.setTouchEmulationEnabled", params: { enabled: true, maxTouchPoints: 5 } },
    { method: "Emulation.setDeviceMetricsOverride", params: { width: 360, height: 800, deviceScaleFactor: 2.5, mobile: true } },
  ], {
    verify: `navigator.userAgent.includes("Android") && innerWidth === 360 && navigator.maxTouchPoints >= 5`,
  }),
  S("geolocation-denied", "Geolocation denied", "Permission denied for geolocation — apps must degrade.", [
    { method: "Browser.setPermission", params: { permission: { name: "geolocation" }, setting: "denied", origin: "%ORIGIN%" } },
  ]),
  S("permissions-denied", "Camera/mic/notifications denied", "Sensitive permissions denied — apps must not break.", [
    { method: "Browser.grantPermissions", params: { permissions: ["geolocation", "notifications", "audioCapture", "videoCapture"], origin: "%ORIGIN%", state: "denied" } },
  ]),
  // This scenario spent its whole life doing the exact opposite of its label.
  //
  // `Security.setIgnoreCertificateErrors {ignore: true}` is the automation
  // switch that makes Chrome ACCEPT a bad certificate. It cannot produce a
  // certificate error; against a site that genuinely has one, it would hide
  // it. So the scenario was incapable of failing, and a scenario that cannot
  // fail is a free point on every scoreboard forever.
  //
  // There is no CDP command that mints a certificate error for an arbitrary
  // origin, and Network.ErrorReason has no certificate member either, so
  // Fetch.failRequest cannot stand in for one. Faking it with a generic
  // transport failure would just be `dns-fail` wearing a different label —
  // still a lie, only a subtler one.
  //
  // Until the fixture server can serve HTTPS with a deliberately broken cert,
  // the honest report is "not tested", so that is what it now reports.
  S("cert-error", "Certificate error (HTTPS fails)", "Bad/expired cert — secure-connection failures.", [], {
    unsupported:
      "CDP cannot inject a certificate error. The only related command, Security.setIgnoreCertificateErrors, suppresses cert errors rather than causing them. Needs an HTTPS fixture server with an intentionally invalid certificate.",
  }),
  // This probe refutes, and unlike the throttling ones the refutation is real.
  //
  // `navigator.connection.saveData` is the ONLY thing a page can observe about
  // data-saver mode — there is no media query, no request header a same-origin
  // page can read, nothing else. Measured: with
  // Emulation.setDataSaverOverride{saveData:true} applied and no CDP error,
  // saveData is still false. The same CDP-inertness that makes
  // navigator.connection.rtt useless applies here, but here it is fatal: if
  // the flag never flips, no page can react, so the scenario cannot affect
  // any site.
  //
  // Left in place, refuting, rather than quietly deleted. It is a real hole
  // and `wr inert` will keep saying so until it is either fixed upstream or
  // consciously dropped.
  S("data-saver", "Data-saver mode", "Reduced data mode — apps should skip heavy media.", [
    { method: "Emulation.setDataSaverOverride", params: { saveData: true } },
  ], { verify: `navigator.connection.saveData === true` }),
  // Writes a throwaway cookie and checks it did not stick. Mutating, but the
  // target is torn down immediately after, and under the scenario the write
  // is a no-op by definition.
  S("cookies-blocked", "Cookies disabled", "No cookies — auth/session-dependent features must degrade.", [
    { method: "Emulation.setDocumentCookieDisabled", params: { disabled: true } },
  ], {
    verify: `(() => { document.cookie = "wr_probe=1"; return !document.cookie.includes("wr_probe"); })()`,
  }),
  S("vision-deficiency", "Vision deficiency (blurred)", "Accessibility — low-contrast/blur-dependent UI fails.", [
    { method: "Emulation.setEmulatedVisionDeficiency", params: { type: "blurredVision" } },
  ], {
    requires:
      "a screenshot comparison. This is a compositor-level filter: it changes no DOM, no CSSOM and no JS-readable state, so nothing the harness currently captures can see it. Needs --screenshot plus image diffing.",
  }),
  S("reduced-motion", "prefers-reduced-motion", "Users with motion sensitivity — animations should be disabled.", [
    { method: "Emulation.setEmulatedMedia", params: { features: [{ name: "prefers-reduced-motion", value: "reduce" }] } },
  ], { verify: `matchMedia("(prefers-reduced-motion: reduce)").matches` }),

  S("sw-bypass", "Service worker bypassed", "The no-SW path — what a first-time visitor without SW support gets.", [
    { method: "Network.setBypassServiceWorker", params: { bypass: true } },
  ]),
  // "mid-session" was never true: before-load wiped storage of an origin that
  // had not loaded yet, which is just a clean first visit. The app has to be
  // running and holding state for this to mean anything.
  S("storage-cleared", "Storage cleared mid-session", "IndexedDB/localStorage wiped — apps must rebuild gracefully.", [
    { method: "Storage.clearDataForOrigin", params: { origin: "%ORIGIN%", storageTypes: "all" } },
  ], { phase: "after-load" }),
  S("virtual-time", "Virtual time (long session fast-forward)", "Long-lived sessions (chat, analytics) — timers/state across hours.", [
    { method: "Emulation.setVirtualTimePolicy", params: { policy: "pauseIfNetworkFetchesPending", budget: 5000 } },
  ]),
  // Runtime.terminateExecution kills whatever is executing in the context
  // right now. Running it before-load pointed it at about:blank, where
  // nothing was executing, and the subsequent navigation then built a fresh
  // context anyway — so the scenario terminated nothing, twice over.
  S("runaway-script", "Runaway script terminated", "An infinite loop is killed — the app must recover, not stay frozen.", [
    { method: "Runtime.terminateExecution", params: {} },
  ], { phase: "after-load" }),
  S("locale-rtl", "Locale override (RTL)", "RTL locale — layout/i18n handling.", [
    { method: "Emulation.setLocaleOverride", params: { locale: "ar" } },
  ], { verify: `new Intl.NumberFormat().resolvedOptions().locale.startsWith("ar")` }),
  S("block-third-party", "Block third-party hosts", "Analytics/TMS/CDN/embeds fail — the China + tag-manager single-point-of-failure case.", [
    { method: "Network.setBlockedURLs", params: { urls: ["*://*.google-analytics.com/*", "*://*.googletagmanager.com/*", "*://*.doubleclick.net/*", "*://*.googleadservices.com/*", "*://*.facebook.net/*", "*://*.facebook.com/*", "*://*.cloudflare.com/*", "*://*.jsdelivr.net/*", "*://*.unpkg.com/*", "*://*.cdnjs.cloudflare.com/*"] } },
  ]),
  S("websocket-drop", "WebSocket connections blocked", "Realtime transport fails — reconnect/resubscribe behavior.", [
    { method: "Network.setBlockedURLs", params: { urls: ["wss://*", "ws://*"] } },
  ], {
    requires:
      "a page that opens a WebSocket. No fixture does, so there is no connection to drop and the scenario is identical to baseline everywhere.",
  }),

  S("media-codec-fail", "Media files blocked", "Video/audio assets fail — codec/CDN issue; element fallback behavior.", [
    { method: "Network.setBlockedURLs", params: { urls: ["*.mp4", "*.webm", "*.mp3", "*.m4a", "*.ogg", "*.opus", "*.wav", "*.aac"] } },
  ], {
    requires:
      "a page that loads audio or video. No fixture does, so there is nothing to block.",
  }),
  S("sw-stop", "Service worker stopped", "The SW dies mid-session (crash, eviction) — page must recover without it.", [
    // ServiceWorker.stopAllWorkers requires the domain to be enabled first.
    // Without this line it failed with "ServiceWorker domain not enabled" on
    // every single run, and the recorded injectionError was never surfaced
    // anywhere a reader would look — so the scenario stopped no workers and
    // still reported a clean pass. Exactly the same shape of bug as the old
    // `sw-unregister`, which called ServiceWorker.enable and nothing else.
    { method: "ServiceWorker.enable", params: {} },
    { method: "ServiceWorker.stopAllWorkers", params: {} },
  ], {
    requires:
      "a page that notices the worker restarting. Stopping a worker is not a durable failure: Chrome spins it back up on the next fetch, so with the command fixed this scenario is now legitimately identical to baseline on every fixture. The states that actually break a SW-dependent app are sw-unregister, sw-bypass and storage-cleared.",
  }),
  S("sw-unregister", "Service worker unregistered", "The SW disappears (user cleared site data, version removed) — the page must work without it.", [
    // This used to be `ServiceWorker.enable` alone, which enables the domain
    // and unregisters precisely nothing: the scenario reported a pass for
    // every site because the worker was still there.
    //
    // clearDataForOrigin rather than ServiceWorker.unregister because the
    // latter needs the exact scopeURL, which the harness cannot know for an
    // arbitrary site.
    { method: "ServiceWorker.enable", params: {} },
    { method: "Storage.clearDataForOrigin", params: { origin: "%ORIGIN%", storageTypes: "service_workers" } },
  ]),
  S("camera-denied", "Camera permission denied", "getUserMedia({video}) denied — apps must degrade, not break.", [
    { method: "Browser.setPermission", params: { permission: { name: "camera" }, setting: "denied", origin: "%ORIGIN%" } },
  ]),
  S("mic-denied", "Microphone permission denied", "getUserMedia({audio}) denied — recording/voice features must degrade.", [
    { method: "Browser.setPermission", params: { permission: { name: "microphone" }, setting: "denied", origin: "%ORIGIN%" } },
  ]),
  S("screen-capture-denied", "Screen capture denied", "getDisplayMedia denied — screen-share features must degrade.", [
    { method: "Browser.setPermission", params: { permission: { name: "display-capture" }, setting: "denied", origin: "%ORIGIN%" } },
  ]),
  S("clipboard-denied", "Clipboard permission denied", "Clipboard read/write denied — copy/paste features must degrade.", [
    { method: "Browser.setPermission", params: { permission: { name: "clipboard-read" }, setting: "denied", origin: "%ORIGIN%" } },
  ]),
  S("sensors-denied", "Sensors permission denied", "Accelerometer/gyro denied — motion features must degrade.", [
    { method: "Browser.setPermission", params: { permission: { name: "accelerometer" }, setting: "denied", origin: "%ORIGIN%" } },
  ]),
  S("wake-lock-denied", "Wake lock denied", "Screen-wake-lock denied — apps should still work, just dim.", [
    { method: "Browser.setPermission", params: { permission: { name: "screen-wake-lock" }, setting: "denied", origin: "%ORIGIN%" } },
  ]),
  S("local-fonts-denied", "Local fonts denied", "Local font enumeration denied — design tools must degrade.", [
    { method: "Browser.setPermission", params: { permission: { name: "local-fonts" }, setting: "denied", origin: "%ORIGIN%" } },
  ]),
  S("window-management-denied", "Window management denied", "Multi-window/PWA window placement denied.", [
    { method: "Browser.setPermission", params: { permission: { name: "window-management" }, setting: "denied", origin: "%ORIGIN%" } },
  ]),
  S("idle-detection-denied", "Idle detection denied", "Idle-detection denied — presence features must degrade.", [
    { method: "Browser.setPermission", params: { permission: { name: "idle-detection" }, setting: "denied", origin: "%ORIGIN%" } },
  ]),
  S("incognito", "Incognito mode", "Private browsing: partitioned, non-persistent storage; cookies/IDB/localStorage behavior.", [], { incognito: true }),
  S("storage-low", "Storage nearly full", "A small quota (1 MB) — writes fail mid-session as storage fills.", [
    { method: "Storage.overrideQuotaForOrigin", params: { origin: "%ORIGIN%", quotaSize: 1048576 } },
  ], { verify: QUOTA_REJECTS_WRITE_OF(8) }),
  S("file-picker", "File picker intercepted (user cancels/ignores)", "The file-system chooser is intercepted — the picker promise never fulfills (user-cancel edge case); apps must not hang or break.", [
    { method: "Page.setInterceptFileChooserDialog", params: { enabled: true } },
  ], {
    requires:
      "a page that opens a file chooser, which means a file input AND an interaction plan that clicks it. Intercepting a dialog nothing ever opens is a no-op.",
  }),
] satisfies readonly ScenarioSpec[];

/** Every id in the matrix, as a union — the single source of truth. */
export type ScenarioId = typeof SCENARIOS[number]["id"];

/** A matrix entry, with its id preserved as a literal type. */
export type Scenario = typeof SCENARIOS[number];


export const SCENARIO_BY_ID = Object.fromEntries(SCENARIOS.map((s) => [s.id, s]));

