// scenarios.ts — the failure-injection matrix as harness-side CDP commands.
// Each scenario is a list of {method, params} applied to the page session
// BEFORE navigation, plus an optional request-pause policy (dns-fail).

export type CdpCommand = { method: string; params: Record<string, unknown> };

export interface ScenarioSpec {
  id: string;
  label: string;
  description: string;
  commands: CdpCommand[];
  /** When set, the harness intercepts requests and fails them with this errorReason. */
  failAllWith?: "NameNotResolved" | "InternetDisconnected" | "TimedOut" | "ConnectionRefused" | "BlockedByClient";
  /** Run the target in an incognito browser context (partitioned storage). */
  incognito?: boolean;
}

const S = (
  id: string,
  label: string,
  description: string,
  commands: CdpCommand[],
  failAllWith?: ScenarioSpec["failAllWith"],
): ScenarioSpec => ({ id, label, description, commands, failAllWith });

export const SCENARIOS: ScenarioSpec[] = [
  S("baseline", "Baseline (no failure injected)", "Normal load — the control run.", [
    { method: "Network.emulateNetworkConditions", params: { offline: false, latency: 0, downloadThroughput: 0, uploadThroughput: 0, connectionType: "none" } },
  ]),
  S("offline", "Fully offline", "The whole page must fail to load; surviving behavior (cache/SW) is the finding.", [
    { method: "Network.emulateNetworkConditions", params: { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0, connectionType: "none" } },
  ]),
  S("dns-fail", "DNS interception (Great Firewall style)", "Every request fails with NameNotResolved — simulates DNS being poisoned/blocked.", [], "NameNotResolved"),
  S("block-js", "Block all JavaScript", "Main scripts fail — tests defensive init, noscript, progressive enhancement.", [
    { method: "Network.setBlockedURLs", params: { urls: ["*.js"] } },
  ]),
  S("block-css", "Block all stylesheets", "CSS fails — tests content usability without styles.", [
    { method: "Network.setBlockedURLs", params: { urls: ["*.css"] } },
  ]),
  S("block-fonts", "Block webfonts", "Fonts fail — tests font-display behavior, fallback stacks, FOIT/FOUT.", [
    { method: "Network.setBlockedURLs", params: { urls: ["*.woff2", "*.woff", "*.ttf", "*.otf"] } },
  ]),
  S("throttled-slow", "Throttled (slow 4G)", "400ms RTT, 1.6 Mbps down — assets starve, LCP/fonts suffer.", [
    { method: "Network.emulateNetworkConditions", params: { offline: false, latency: 400, downloadThroughput: 200000, uploadThroughput: 100000, connectionType: "cellular3g" } },
  ]),
  S("throttled-2g", "Throttled (2G)", "1500ms RTT, 250 Kbps down — the extreme case.", [
    { method: "Network.emulateNetworkConditions", params: { offline: false, latency: 1500, downloadThroughput: 30000, uploadThroughput: 15000, connectionType: "cellular2g" } },
  ]),
  S("cpu-6x", "CPU throttled 6x", "Low-end device CPU — long tasks, INP, jank.", [
    { method: "Emulation.setCPUThrottlingRate", params: { rate: 6 } },
  ]),
  S("cpu-20x", "CPU throttled 20x", "Extreme low-end — interaction responsiveness.", [
    { method: "Emulation.setCPUThrottlingRate", params: { rate: 20 } },
  ]),
  S("memory-critical", "Memory pressure (critical)", "Simulates low-memory devices; browsers may discard pages/tabs.", [
    { method: "Memory.setPressureNotificationsSuppressed", params: { suppressed: true } },
    { method: "Memory.simulatePressureNotification", params: { level: "critical" } },
  ]),
  S("tab-crash", "Renderer crash + reload", "Page.crash then reload — tests crash recovery, state preservation.", [
    { method: "Page.crash", params: {} },
  ]),
  S("backgrounded", "Frozen/backgrounded", "Freeze then resume — timers, persistence, visibility handling.", [
    { method: "Page.setWebLifecycleState", params: { state: "frozen" } },
  ]),
  S("no-cache", "No cache / cold start", "Cache disabled — the true first-load cost.", [
    { method: "Network.setCacheDisabled", params: { cacheDisabled: true } },
  ]),
  S("storage-quota", "Storage quota exhausted", "IndexedDB/localStorage writes fail — tests quota-aware persistence.", [
    { method: "Storage.overrideQuotaForOrigin", params: { origin: "%ORIGIN%", quotaSize: 0 } },
  ]),
  S("hardware-concurrency", "Hardware concurrency = 1", "Single-core device — worker/pool assumptions.", [
    { method: "Emulation.setHardwareConcurrencyOverride", params: { hardwareConcurrency: 1 } },
  ]),
  S("mobile", "Mobile device (UA + touch + small viewport)", "The low-end phone environment: touch interaction, small screen, mobile UA.", [
    { method: "Emulation.setUserAgentOverride", params: { userAgent: "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36", platform: "Android", mobile: true } },
    { method: "Emulation.setTouchEmulationEnabled", params: { enabled: true, maxTouchPoints: 5 } },
    { method: "Emulation.setDeviceMetricsOverride", params: { width: 360, height: 800, deviceScaleFactor: 2.5, mobile: true } },
  ]),
  S("geolocation-denied", "Geolocation denied", "Permission denied for geolocation — apps must degrade.", [
    { method: "Browser.setPermission", params: { permission: { name: "geolocation" }, setting: "denied", origin: "%ORIGIN%" } },
  ]),
  S("permissions-denied", "Camera/mic/notifications denied", "Sensitive permissions denied — apps must not break.", [
    { method: "Browser.grantPermissions", params: { permissions: ["geolocation", "notifications", "audioCapture", "videoCapture"], origin: "%ORIGIN%", state: "denied" } },
  ]),
  S("cert-error", "Certificate error (HTTPS fails)", "Bad/expired cert — secure-connection failures.", [
    { method: "Security.setIgnoreCertificateErrors", params: { ignore: true } },
  ]),
  S("data-saver", "Data-saver mode", "Reduced data mode — apps should skip heavy media.", [
    { method: "Emulation.setDataSaverOverride", params: { saveData: true } },
  ]),
  S("cookies-blocked", "Cookies disabled", "No cookies — auth/session-dependent features must degrade.", [
    { method: "Emulation.setDocumentCookieDisabled", params: { disabled: true } },
  ]),
  S("vision-deficiency", "Vision deficiency (blurred)", "Accessibility — low-contrast/blur-dependent UI fails.", [
    { method: "Emulation.setEmulatedVisionDeficiency", params: { type: "blurredVision" } },
  ]),
  S("reduced-motion", "prefers-reduced-motion", "Users with motion sensitivity — animations should be disabled.", [
    { method: "Emulation.setEmulatedMedia", params: { features: [{ name: "prefers-reduced-motion", value: "reduce" }] } },
  ]),
  S("sw-bypass", "Service worker bypassed", "The no-SW path — what a first-time visitor without SW support gets.", [
    { method: "Network.setBypassServiceWorker", params: { bypass: true } },
  ]),
  S("storage-cleared", "Storage cleared mid-session", "IndexedDB/localStorage wiped — apps must rebuild gracefully.", [
    { method: "Storage.clearDataForOrigin", params: { origin: "%ORIGIN%", storageTypes: "all" } },
  ]),
  S("virtual-time", "Virtual time (long session fast-forward)", "Long-lived sessions (chat, analytics) — timers/state across hours.", [
    { method: "Emulation.setVirtualTimePolicy", params: { policy: "pauseIfNetworkFetchesPending", budget: 5000 } },
  ]),
  S("runaway-script", "Runaway script terminated", "An infinite loop is killed — the app must recover, not stay frozen.", [
    { method: "Runtime.terminateExecution", params: {} },
  ]),
  S("locale-rtl", "Locale override (RTL)", "RTL locale — layout/i18n handling.", [
    { method: "Emulation.setLocaleOverride", params: { locale: "ar" } },
  ]),
  S("block-third-party", "Block third-party hosts", "Analytics/TMS/CDN/embeds fail — the China + tag-manager single-point-of-failure case.", [
    { method: "Network.setBlockedURLs", params: { urls: ["*://*.google-analytics.com/*", "*://*.googletagmanager.com/*", "*://*.doubleclick.net/*", "*://*.googleadservices.com/*", "*://*.facebook.net/*", "*://*.facebook.com/*", "*://*.cloudflare.com/*", "*://*.jsdelivr.net/*", "*://*.unpkg.com/*", "*://*.cdnjs.cloudflare.com/*"] } },
  ]),
  S("websocket-drop", "WebSocket connections blocked", "Realtime transport fails — reconnect/resubscribe behavior.", [
    { method: "Network.setBlockedURLs", params: { urls: ["wss://*", "ws://*"] } },
  ]),
  S("media-codec-fail", "Media files blocked", "Video/audio assets fail — codec/CDN issue; element fallback behavior.", [
    { method: "Network.setBlockedURLs", params: { urls: ["*.mp4", "*.webm", "*.mp3", "*.m4a", "*.ogg", "*.opus", "*.wav", "*.aac"] } },
  ]),
  S("sw-stop", "Service worker stopped", "The SW dies mid-session (crash, eviction) — page must recover without it.", [
    { method: "ServiceWorker.stopAllWorkers", params: {} },
  ]),
  S("sw-unregister", "Service worker unregistered", "The SW disappears (user cleared site data, version removed) — the page must work without it.", [
    { method: "ServiceWorker.enable", params: {} },
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
  S("incognito", "Incognito mode", "Private browsing: partitioned, non-persistent storage; cookies/IDB/localStorage behavior.", [], undefined, true),
];

export const SCENARIO_BY_ID = Object.fromEntries(SCENARIOS.map((s) => [s.id, s]));
