// types.ts — the audit scenario matrix and the structured findings report.
// The audit skill consumes a URL; the harness injects a scenario and emits a
// ScenarioReport. The eval framework scores reports against independent
// rubrics — the skills never see the rubrics (competitive isolation).

export type ScenarioId =
  | "offline"
  | "dns-fail"
  | "block-js"
  | "block-css"
  | "block-fonts"
  | "block-images"
  | "throttled-slow"
  | "throttled-2g"
  | "cpu-6x"
  | "cpu-20x"
  | "memory-critical"
  | "tab-crash"
  | "backgrounded"
  | "no-cache"
  | "storage-quota"
  | "hardware-concurrency"
  | "baseline";

export interface ScenarioSpec {
  id: ScenarioId;
  label: string;
  /** CDP injection, applied against the page session. */
  inject: string; // JS expression string (async, has access to a `cdp` helper)
  description: string;
}

export interface NetworkFailure {
  url: string;
  resourceType: string;
  errorText: string | null;
  canceled: boolean;
  blockedReason: string | null;
}

export interface ConsoleEntry {
  type: string;
  text: string;
}

export interface PerfMetrics {
  fcpMs: number | null;
  lcpMs: number | null;
  cls: number | null;
  domContentLoadedMs: number | null;
  loadMs: number | null;
}

export interface FontProbe {
  family: string;
  status: string; // loaded | error | unloaded | loading
  usedFallback: boolean;
}

export interface ScenarioReport {
  scenario: ScenarioId;
  url: string;
  startedAt: string;
  durationMs: number;
  navSucceeded: boolean;
  finalUrl: string | null;
  crashDetected: boolean;
  networkFailures: NetworkFailure[];
  consoleErrors: ConsoleEntry[];
  uncaughtExceptions: ConsoleEntry[];
  perf: PerfMetrics;
  fonts: FontProbe[];
  pageTextSample: string | null; // truncated body text — lets text models analyze
  screenshotPath: string | null;
  extra: Record<string, unknown>;
}

export interface AuditReport {
  url: string;
  engine: {
    chrome: string;
    cdpDomains: number;
    runner: string;
  };
  generatedAt: string;
  scenarios: ScenarioReport[];
}
