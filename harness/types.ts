// types.ts — the structured findings report.
// The audit skill consumes a URL; the harness injects a scenario and emits a
// ScenarioReport. The eval framework scores reports against independent
// rubrics — the skills never see the rubrics (competitive isolation).
//
// ScenarioId is derived from the matrix in scenarios.ts. It used to be a
// hand-written union here and had drifted badly (17 ids listed, 46 defined),
// which is why report code needed `as never` casts to compile.

export type { ScenarioId } from "./scenarios.ts";
import type { ScenarioId } from "./scenarios.ts";


export interface NetworkFailure {
  /**
   * Resolved from the matching Network.requestWillBeSent — CDP's
   * loadingFailed event carries only a requestId, so without correlation a
   * finding cannot name the asset that died.
   */
  url: string | null;
  resourceType: string | null;
  errorText: string | null;
  canceled: boolean;
  blockedReason: string | null;
  /** Remaining CDP fields (requestId, timestamp, corsErrorStatus, ...). */
  [key: string]: unknown;
}

/** Raw Runtime.consoleAPICalled / Runtime.exceptionThrown payloads. */
export interface ConsoleEntry {
  type?: string;
  text?: string;
  [key: string]: unknown;
}

export interface PerfMetrics {
  /** Performance.getMetrics, keyed by metric name. */
  metrics?: Record<string, number>;
  /** PerformanceNavigationTiming highlights, in ms. */
  nav?: {
    fcp: number | null;
    dcl: number | null;
    load: number | null;
  } | null;
}

export interface FontProbe {
  family: string;
  status: string; // loaded | error | unloaded | loading
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
  /**
   * Set when the harness itself failed to complete this scenario (browser
   * died, CDP timed out). Distinct from a finding: an absent report must never
   * be read as "the site coped".
   */
  harnessError?: string;
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
