import { assertEquals } from "@std/assert";
import { classifyInertness } from "./inertness.ts";

// deno-lint-ignore no-explicit-any
function scenario(id: string, over: Record<string, unknown> = {}): any {
  return {
    scenario: id,
    navSucceeded: true,
    crashDetected: false,
    finalUrl: "http://x/",
    networkFailures: [],
    consoleErrors: [],
    uncaughtExceptions: [],
    browserLogs: [],
    pageTextSample: "hello",
    ...over,
  };
}

Deno.test("a scenario identical to baseline on every fixture is inert everywhere", () => {
  const report = classifyInertness([
    {
      fixture: "a",
      scenarios: [scenario("baseline"), scenario("offline")],
    },
    {
      fixture: "b",
      scenarios: [scenario("baseline"), scenario("offline")],
    },
  ]);
  assertEquals(report.inertEverywhere, ["offline"]);
  assertEquals(report.inertSomewhere, []);
});

Deno.test("a scenario that differs on one fixture is only inert somewhere", () => {
  const report = classifyInertness([
    { fixture: "a", scenarios: [scenario("baseline"), scenario("offline")] },
    {
      fixture: "b",
      scenarios: [
        scenario("baseline"),
        scenario("offline", { navSucceeded: false }),
      ],
    },
  ]);
  assertEquals(report.inertEverywhere, []);
  assertEquals(report.inertSomewhere, ["offline"]);
});

Deno.test("unrun scenarios do not count as evidence either way", () => {
  const report = classifyInertness([
    {
      fixture: "a",
      scenarios: [
        scenario("baseline"),
        scenario("offline", { harnessError: "boom" }),
      ],
    },
  ]);
  // Nothing ran, so nothing is claimed. Counting an unrun scenario as inert
  // would blame the scenario for the harness giving up on it.
  assertEquals(report.inertEverywhere, []);
  assertEquals(report.inertSomewhere, []);
});

Deno.test("timing noise alone does not make a scenario look alive", () => {
  // perf/durationMs are excluded from the fingerprint on purpose: they differ
  // on every run, so if they counted, nothing would ever be reported inert.
  const report = classifyInertness([
    {
      fixture: "a",
      scenarios: [
        scenario("baseline", { durationMs: 100, perf: { lcp: 1 } }),
        scenario("cpu-6x", { durationMs: 9999, perf: { lcp: 42 } }),
      ],
    },
  ]);
  assertEquals(report.inertEverywhere, ["cpu-6x"]);
});

Deno.test("a fixture with no baseline is skipped rather than guessed at", () => {
  const report = classifyInertness([
    { fixture: "a", scenarios: [scenario("offline")] },
    { fixture: "b", scenarios: [scenario("baseline"), scenario("offline")] },
  ]);
  // Only fixture b contributed a verdict, and there offline was identical.
  assertEquals(report.inertEverywhere, ["offline"]);
});
