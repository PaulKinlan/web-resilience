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
];

export const SCENARIO_BY_ID = Object.fromEntries(SCENARIOS.map((s) => [s.id, s]));
