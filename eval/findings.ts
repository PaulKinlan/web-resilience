// findings.ts — score an AGENT's findings report against the frozen rubric.
//
// score.ts scores what the HARNESS detected. That is the right measure for
// harness work, but it is blind to the skills: SKILL.md and the guides are
// prose consumed by an agent the harness never invokes, so no edit to them can
// move a score.ts number by a single point.
//
// This module closes that gap. The unit of measurement is the findings report
// the audit skill tells the agent to emit — which means the skill's two real
// levers (how it drives the harness, and how it reads the result) finally
// register.

import type { Rubric } from "./score.ts";

/** One finding, as the audit skill instructs the agent to emit it. */
export interface AgentFinding {
  scenario: string;
  /** The failure class, matching the rubric's vocabulary. */
  class: string;
  severity?: string;
  /** Quoted evidence from the report. Not matched on; recorded for review. */
  signal?: string;
  resource?: string;
  summary?: string;
}

export interface AgentFindingsReport {
  url?: string;
  findings: AgentFinding[];
}

export interface FindingsScore {
  fixture: string;
  version: number;
  /** Rubric entries the agent was expected to report. */
  expected: number;
  matched: number;
  missed: string[];
  /** Reported despite the rubric saying the site handles this correctly. */
  falseClaims: string[];
  /** Reported but not described by the rubric at all. */
  extras: string[];
  falsePositives: number;
  precision: number;
  recall: number;
  /** Right class, wrong severity. Recorded, not penalised. */
  severityMismatches: string[];
}

const key = (scenario: string, cls: string) => `${scenario}/${cls}`;

/**
 * Match on (scenario, class), not on the signal text: the agent writes prose
 * and matching that would score phrasing rather than detection.
 *
 * `notPresent` is deliberately ignored here. It tells the harness scorer that
 * a finding is detected by the ABSENCE of a raw signal; at the agent level the
 * only question is whether the agent reported the issue, which `expected`
 * already answers.
 */
export function scoreFindings(
  report: AgentFindingsReport,
  rubric: Rubric,
  options: { strictExtras?: boolean } = {},
): FindingsScore {
  const strictExtras = options.strictExtras ?? true;

  const reported = new Map<string, AgentFinding>();
  for (const f of report.findings ?? []) {
    // First report of a class wins; duplicates must not inflate anything.
    if (!reported.has(key(f.scenario, f.class))) {
      reported.set(key(f.scenario, f.class), f);
    }
  }

  const missed: string[] = [];
  const falseClaims: string[] = [];
  const severityMismatches: string[] = [];
  const describedByRubric = new Set<string>();
  let matched = 0;
  let expected = 0;

  for (const entry of rubric.expectedFindings) {
    const k = key(entry.scenario, entry.class);
    describedByRubric.add(k);
    const hit = reported.get(k);

    if (entry.expected) {
      expected++;
      if (hit) {
        matched++;
        if (hit.severity && hit.severity !== entry.severity) {
          severityMismatches.push(`${entry.id}: said ${hit.severity}, rubric says ${entry.severity}`);
        }
      } else {
        missed.push(entry.id);
      }
    } else if (hit) {
      // The rubric asserts the site handles this correctly; claiming a failure
      // here is the agent inventing a problem.
      falseClaims.push(entry.id);
    }
  }

  // Findings the rubric says nothing about. Penalised by default: without
  // this, an agent maximises its score by reporting every class against every
  // scenario. The cost is that a genuinely novel finding also scores against
  // it — which is the correct trade for a controlled fixture, and why this is
  // a flag rather than a hard rule.
  const extras = [...reported.keys()].filter((k) => !describedByRubric.has(k)).sort();

  const falsePositives = falseClaims.length + (strictExtras ? extras.length : 0);
  const recall = matched / Math.max(expected, 1);
  const precision = matched / Math.max(matched + falsePositives, 1);

  return {
    fixture: rubric.fixture,
    version: rubric.version,
    expected,
    matched,
    missed,
    falseClaims,
    extras,
    falsePositives,
    precision: Math.round(precision * 100) / 100,
    recall: Math.round(recall * 100) / 100,
    severityMismatches,
  };
}

/**
 * Parse an agent's findings report. Tolerant of a bare array and of a report
 * wrapped in a markdown code fence, because that is what agents actually emit.
 */
export function parseFindings(contents: string): AgentFindingsReport {
  let text = contents.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();

  const value = JSON.parse(text);
  if (Array.isArray(value)) return { findings: value };
  if (!Array.isArray(value.findings)) {
    throw new Error("findings report must have a `findings` array");
  }
  return value;
}
