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
  totalFindings: number;
  matched: number;
  missed: number;
  falsePositives: number;
  precision: number;
  recall: number;
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
    fonts: sc.fonts,
    page: (sc.pageTextSample ?? "").slice(0, 500),
  }).toLowerCase();
  const signal = f.signal.toLowerCase();
  const present = text.includes(signal);
  return f.notPresent ? !present : present;
}

export function scoreAudit(report: AuditReport, rubric: { expectedFindings: RubricFinding[] }): Score {
  const perClass: Record<string, { total: number; matched: number }> = {};
  let matched = 0;
  let falsePositives = 0;
  const missed: string[] = [];

  for (const f of rubric.expectedFindings) {
    perClass[f.class] ??= { total: 0, matched: 0 };
    perClass[f.class].total++;
    const detected = signalDetected(report, f);
    if (f.expected) {
      if (detected) { matched++; perClass[f.class].matched++; }
      else missed.push(f.id);
    } else {
      if (detected) falsePositives++; // site claimed resilient but the signal appeared
      else matched++;
    }
  }
  const total = rubric.expectedFindings.length;
  const recall = matched / Math.max(total, 1);
  const precision = matched / Math.max(matched + falsePositives, 1);
  return {
    fixture: rubric.fixture,
    version: rubric.version,
    totalFindings: total,
    matched,
    missed: missed.length,
    falsePositives,
    precision: Math.round(precision * 100) / 100,
    recall: Math.round(recall * 100) / 100,
    perClass,
  };
}
