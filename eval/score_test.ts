import { assertEquals } from "@std/assert";
import { type Rubric, scoreAudit } from "./score.ts";
import type { AuditReport, ScenarioReport } from "../harness/types.ts";

function scenario(partial: Partial<ScenarioReport>): ScenarioReport {
  return {
    scenario: "baseline",
    url: "http://example.test/",
    startedAt: new Date().toISOString(),
    durationMs: 1,
    navSucceeded: true,
    finalUrl: null,
    crashDetected: false,
    networkFailures: [],
    consoleErrors: [],
    uncaughtExceptions: [],
    browserLogs: [],
    perf: {},
    fonts: [],
    pageTextSample: null,
    screenshotPath: null,
    extra: {},
    ...partial,
  } as ScenarioReport;
}

function report(scenarios: ScenarioReport[]): AuditReport {
  return {
    url: "http://example.test/",
    engine: { chrome: "test", cdpDomains: 0, runner: "test" },
    generatedAt: new Date().toISOString(),
    scenarios,
  };
}

const rubric: Rubric = {
  fixture: "test",
  version: 1,
  expectedFindings: [{
    id: "offline-blank",
    scenario: "offline",
    class: "offline-fallback",
    severity: "critical",
    signal: "err_internet_disconnected",
    expected: true,
  }],
};

Deno.test("an incomplete matrix is counted, not hidden", () => {
  // The real failure this guards: 24 of 46 scenarios never ran, yet every
  // rubric finding lived in the 22 that did, so the audit scored a clean pass.
  const score = scoreAudit(
    report([
      scenario({
        scenario: "offline",
        pageTextSample: "ERR_INTERNET_DISCONNECTED",
      }),
      scenario({ scenario: "block-js", harnessError: "browser gone" }),
      scenario({ scenario: "block-css", harnessError: "browser gone" }),
    ]),
    rubric,
  );
  assertEquals(score.matched, 1);
  assertEquals(score.recall, 1); // the rubric looks perfectly satisfied...
  assertEquals(score.scenariosUnrun, 2); // ...but two thirds of the run is missing
  assertEquals(score.scenariosRun, 1);
});

Deno.test("a complete matrix reports zero unrun", () => {
  const score = scoreAudit(
    report([scenario({ scenario: "offline", pageTextSample: "ERR_INTERNET_DISCONNECTED" })]),
    rubric,
  );
  assertEquals(score.scenariosUnrun, 0);
  assertEquals(score.scenariosRun, 1);
});

Deno.test("browser logs are matchable, so CSP findings are scoreable", () => {
  // CSP violations arrive only via Log.entryAdded. Before browserLogs was
  // captured and included in the matchable text, this scored zero.
  const cspRubric: Rubric = {
    fixture: "csp",
    version: 1,
    expectedFindings: [{
      id: "csp-inline-script",
      scenario: "baseline",
      class: "csp-policy",
      severity: "major",
      signal: "executing inline script violates",
      expected: true,
    }],
  };
  const score = scoreAudit(
    report([
      scenario({
        browserLogs: [{
          level: "info",
          source: "security",
          text: "Executing inline script violates the following Content Security Policy directive",
        }],
      }),
    ]),
    cspRubric,
  );
  assertEquals(score.matched, 1);
});

Deno.test("a finding that only restates the baseline is marked hollow", () => {
  // The real case: reference/ref-offline-shell asserted the site's own title
  // appears under `offline`. It does — it also appears with nothing injected,
  // and the offline scenario's report was byte-identical to baseline. The
  // entry scored a point while proving nothing.
  const hollowRubric: Rubric = {
    fixture: "test",
    version: 1,
    expectedFindings: [{
      id: "shell-renders",
      scenario: "offline",
      class: "offline-fallback",
      severity: "critical",
      signal: "resilient club",
      expected: true,
    }],
  };
  const identical = { pageTextSample: "Resilient Club — ready" };
  const score = scoreAudit(
    report([
      scenario({ scenario: "baseline", ...identical }),
      scenario({ scenario: "offline", ...identical }),
    ]),
    hollowRubric,
  );
  assertEquals(score.matched, 1); // still scores...
  assertEquals(score.strength.hollow, 1); // ...on no evidence at all
  assertEquals(score.hollowFindings, ["shell-renders"]);
});

Deno.test("surviving a failure that demonstrably happened is not hollow", () => {
  // Same assertion, but the scenario left a mark. The site really did keep
  // rendering through a real failure, which is a weaker claim than `strong`
  // but an honest one — and must not be lumped in with the hollow entries.
  const hollowRubric: Rubric = {
    fixture: "test",
    version: 1,
    expectedFindings: [{
      id: "shell-renders",
      scenario: "offline",
      class: "offline-fallback",
      severity: "critical",
      signal: "resilient club",
      expected: true,
    }],
  };
  const score = scoreAudit(
    report([
      scenario({ scenario: "baseline", pageTextSample: "Resilient Club — ready" }),
      scenario({
        scenario: "offline",
        pageTextSample: "Resilient Club — ready",
        networkFailures: [{
          url: "http://example.test/logo.png",
          resourceType: "Image",
          errorText: "net::ERR_INTERNET_DISCONNECTED",
          canceled: false,
          blockedReason: null,
        }],
      }),
    ]),
    hollowRubric,
  );
  assertEquals(score.strength.hollow, 0);
  assertEquals(score.strength.survives, 1);
});

Deno.test("a signal absent at baseline and present under failure is strong", () => {
  const score = scoreAudit(
    report([
      scenario({ scenario: "baseline", pageTextSample: "all good" }),
      scenario({ scenario: "offline", pageTextSample: "ERR_INTERNET_DISCONNECTED" }),
    ]),
    rubric,
  );
  assertEquals(score.strength.strong, 1);
  assertEquals(score.strength.hollow, 0);
});

