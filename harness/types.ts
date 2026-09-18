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

/**
 * Log.entryAdded — messages the BROWSER generates, as distinct from ones the
 * page's own code calls console.error() for.
 *
 * This is where CSP violations, CORS rejections, mixed content, deprecations
 * and interventions live. The audit enabled the Log domain but never
 * subscribed, so none of it reached a report: a page could be reporting CSP
 * violations on every load and the audit would call it clean.
 */
export interface BrowserLogEntry {
  /** verbose | info | warning | error */
  level?: string;
  /** xml | javascript | network | security | deprecation | intervention | ... */
  source?: string;
  text?: string;
  url?: string;
  [key: string]: unknown;
}

export interface NavigationPerfMetrics {
  fcp: number | null;
  lcp: number | null;
  /** Accumulated shifts without recent input during the probe, not session-window CLS. */
  cls: number | null;
  dcl: number | null;
  load: number | null;
}

export interface PerfMetrics {
  /** Performance.getMetrics, keyed by metric name; empty when unavailable. */
  metrics: Record<string, number>;
  /** Paint/navigation timings in ms, plus the unitless layout shift score. */
  nav: NavigationPerfMetrics;
  /** Flat compatibility fields mirror nav, including null when unmeasured. */
  fcpMs: number | null;
  lcpMs: number | null;
  cls: number | null;
  domContentLoadedMs: number | null;
  loadMs: number | null;
}

export interface FontProbe {
  family: string;
  status: string; // loaded | error | unloaded | loading
}


/**
 * Whether the scenario's failure was demonstrably in force when the page was
 * measured.
 *
 * Every other field in this report describes what the SITE did. This one
 * describes what the HARNESS did, and it exists because the two were
 * indistinguishable. A scenario that silently injects nothing produces a clean
 * report, and a clean report is scored as the site coping — so a broken
 * injection was being laundered into a passing grade.
 *
 *  - `confirmed`   — the probe ran and proved the failure was in force.
 *  - `refuted`     — the probe ran and proved it was NOT. A harness bug.
 *                    Nothing in this report is evidence about the site.
 *  - `unverified`  — no probe is defined. The default, and not a complaint:
 *                    most resource-blocking scenarios are self-evidencing via
 *                    networkFailures.
 *  - `unsupported` — the failure cannot be injected with CDP at all. Declared
 *                    in the matrix, not discovered at runtime.
 *  - `error`       — the probe itself threw. Says nothing either way.
 */
export interface InjectionCheck {
  status: "confirmed" | "refuted" | "unverified" | "unsupported" | "error";
  /** The probe expression, when there was one. */
  expression?: string;
  /** What the probe returned, for debugging a `refuted`. */
  value?: unknown;
  /** Why, for `unsupported` and `error`. */
  detail?: string;
  /**
   * A page capability the scenario needs before it can show anything. Set
   * from the matrix when declared; the reason a scenario can be both
   * correctly injected and completely silent.
   */
  requires?: string;
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
  /** Browser-generated diagnostics: CSP, CORS, mixed content, deprecations. */
  browserLogs: BrowserLogEntry[];
  perf: PerfMetrics;
  fonts: FontProbe[];
  pageTextSample: string | null; // truncated body text — lets text models analyze
  screenshotPath: string | null;
  /** Did the failure this scenario names actually happen? */
  injection: InjectionCheck;
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
