// score.ts — score an AuditReport against a rubric (precision/recall per class).
// The audit skill never sees the rubric: this module + run-eval.ts are the only
// places the ground truth is read.

import type { AuditReport } from "../harness/types.ts";

export interface RubricFinding {
  id: string;
  scenario: string;
  class: string;
  severity: string;
  signal: string;
  expected: boolean; // true = issue SHOULD be present; false = site SHOULD be resilient
  notPresent?: boolean; // true = the ABSENCE of the signal is the finding
}

export interface Score {
  fixture: string;
  version: number;
  /**
   * Scenarios the harness could not complete. A score computed over a partial
   * matrix is not comparable with one computed over a full matrix, and a
   * rubric whose findings happen to sit in the scenarios that DID run will
   * report a clean pass over a half-finished audit.
   */
  scenariosRun: number;
  scenariosUnrun: number;
  totalFindings: number;
  matched: number;
  missed: number;
  falsePositives: number;
  precision: number;
  recall: number;
  /**
   * Evidence quality behind `matched`. A 5/5 made of hollow entries and a 5/5
   * made of strong ones are the same number but not the same result, and
   * before this there was no way to tell them apart.
   */
  strength: Record<FindingStrength, number>;
  /** Ids of entries that pass without the scenario being observed to do anything. */
  hollowFindings: string[];
  perClass: Record<string, { total: number; matched: number }>;
}

/** Heuristic matcher: does the audit report show the signal the rubric expects? */
function signalDetected(report: AuditReport, f: RubricFinding): boolean {
  const sc = report.scenarios.find((s) => s.scenario === f.scenario);
  if (!sc) return false;
  const text = JSON.stringify({
    failures: sc.networkFailures,
    consoleErrors: sc.consoleErrors,
    exceptions: sc.uncaughtExceptions,
    // Browser-generated diagnostics. CSP violations appear ONLY here, so
    // without this a report-only policy is unscoreable.
    browserLogs: sc.browserLogs ?? [],
    fonts: sc.fonts,
    page: (sc.pageTextSample ?? "").slice(0, 500),
  }).toLowerCase();
  const signal = f.signal.toLowerCase();
  const present = text.includes(signal);
  return f.notPresent ? !present : present;
}

/**
 * How much evidence a matched finding actually carries.
 *
 * A rubric entry names a scenario and a signal, but nothing has ever checked
 * that the signal has anything to do with the scenario. If the signal is
 * already satisfied in the BASELINE run — with no failure injected — the entry
 * passes regardless of what the scenario does, or whether it does anything at
 * all. Six of thirty entries were in exactly that state when this was added.
 *
 * - `strong`   — signal absent at baseline, present in the scenario. The entry
 *                ties the finding to the injected failure. A real test.
 * - `survives` — signal true in both, but the scenario produced some other
 *                observable change. A legitimate resilience assertion ("the
 *                shell still renders offline"); weaker, because it does not
 *                identify what survived, but it is measuring a real event.
 * - `hollow`   — signal true in both AND the scenario's report is identical to
 *                baseline. Nothing was observed to happen. The entry is
 *                re-measuring the baseline under another name: free points
 *                that cannot regress and cannot detect the scenario breaking.
 * - `baseline` — the entry asserts about the baseline scenario itself, so
 *                there is nothing to compare it against. Not a defect.
 * - `unmet`    — the assertion does not hold even in its own scenario.
 */
export type FindingStrength = "strong" | "survives" | "hollow" | "baseline" | "unmet";

export interface Rubric {
  fixture: string;
  version: number;
  expectedFindings: RubricFinding[];
}

/**
 * Everything observable about a scenario, minus timing. Perf and duration are
 * excluded deliberately: they differ on every run regardless of what was
 * injected, so including them would make every scenario look alive.
 *
 * Harness diagnostics are excluded for a sharper reason. `extra.injectionErrors`
 * records CDP commands that failed, and it used to be folded in here — so a
 * scenario whose injection was broken differed from baseline *because* it was
 * broken, and any finding resting on it was promoted from `hollow` to
 * `survives`. Harness failure was being counted as evidence of site behaviour.
 *
 * Caught when `sw-stop` was fixed: its command had been failing with
 * "ServiceWorker domain not enabled" since it was written, and the error text
 * was the only thing distinguishing that scenario from baseline. Repairing the
 * scenario removed the difference and correctly exposed the finding as hollow.
 *
 * `injection` is excluded by the same logic, and by construction: this builds
 * its object from a fixed list of keys rather than by copying the report.
 */
function observable(sc: Record<string, unknown>): string {
  const arr = (k: string) => (sc[k] as Array<Record<string, unknown>>) ?? [];
  const { injectionErrors: _injectionErrors, ...siteExtra } =
    (sc.extra as Record<string, unknown>) ?? {};
  return JSON.stringify({
    nav: sc.navSucceeded,
    crash: sc.crashDetected,
    finalUrl: sc.finalUrl,
    net: arr("networkFailures")
      .map((f) => `${f.resourceType}:${f.errorText ?? f.blockedReason}`).sort(),
    con: arr("consoleErrors").map((c) => JSON.stringify(c.args ?? c).slice(0, 200)).sort(),
    exc: arr("uncaughtExceptions").map((e) => JSON.stringify(e).slice(0, 200)).sort(),
    logs: arr("browserLogs")
      .map((l) => `${l.source}/${l.level}/${String(l.text ?? "").slice(0, 120)}`).sort(),
    fonts: sc.fonts,
    text: ((sc.pageTextSample as string) ?? "").trim(),
    extra: siteExtra,
  });
}

export function classifyStrength(
  report: AuditReport,
  f: RubricFinding,
): FindingStrength {
  if (f.scenario === "baseline") return "baseline";
  const sc = report.scenarios.find((s) => s.scenario === f.scenario);
  const base = report.scenarios.find((s) => s.scenario === "baseline");
  if (!sc || !base) return "unmet";
  if (!signalDetected(report, f)) return "unmet";
  // Does the signal already hold with nothing injected?
  const atBaseline = signalDetected(report, { ...f, scenario: "baseline" });
  if (!atBaseline) return "strong";
  return observable(sc as unknown as Record<string, unknown>) ===
      observable(base as unknown as Record<string, unknown>)
    ? "hollow"
    : "survives";
}

export function scoreAudit(report: AuditReport, rubric: Rubric): Score {
  const perClass: Record<string, { total: number; matched: number }> = {};
  let matched = 0;
  let falsePositives = 0;
  const missed: string[] = [];
  const strength: Record<FindingStrength, number> = {
    strong: 0,
    survives: 0,
    hollow: 0,
    baseline: 0,
    unmet: 0,
  };
  const hollowFindings: string[] = [];

  for (const f of rubric.expectedFindings) {
    perClass[f.class] ??= { total: 0, matched: 0 };
    perClass[f.class].total++;
    const detected = signalDetected(report, f);
    // satisfied = the audit report matches what the rubric expects to be
    // found (expected:true = the audit SHOULD find this; expected:false = the
    // audit should NOT find this).
    const satisfied = f.expected ? detected : !detected;
    if (satisfied) { matched++; perClass[f.class].matched++; }
    else if (f.expected) missed.push(f.id);
    else falsePositives++;

    // Only entries the rubric expects to be FOUND carry evidence. An
    // `expected: false` entry asserts an absence, which has no baseline
    // contrast to measure.
    if (f.expected) {
      const s = classifyStrength(report, f);
      strength[s]++;
      if (s === "hollow") hollowFindings.push(f.id);
    }
  }
  const total = rubric.expectedFindings.length;
  const recall = matched / Math.max(total, 1);
  const precision = matched / Math.max(matched + falsePositives, 1);
  return {
    fixture: rubric.fixture,
    version: rubric.version,
    scenariosRun: report.scenarios.filter((s) => !s.harnessError).length,
    scenariosUnrun: report.scenarios.filter((s) => s.harnessError).length,
    totalFindings: total,
    matched,
    missed: missed.length,
    falsePositives,
    precision: Math.round(precision * 100) / 100,
    recall: Math.round(recall * 100) / 100,
    strength,
    hollowFindings,
    perClass,
  };
}
