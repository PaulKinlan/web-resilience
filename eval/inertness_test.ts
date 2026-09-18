import { assertEquals } from "@std/assert";
import { causeOf, classifyInertness } from "./inertness.ts";

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

// --- cause classification ---------------------------------------------------
//
// The point of these is that the five causes have five different owners. A
// misclassification does not just mislabel a row, it sends the work to the
// wrong place: a `fixture-gap` filed as a harness bug wastes a debugging
// session, and a harness bug filed as a fixture gap never gets fixed at all.

Deno.test("a refuted injection is a harness bug, not a fixture gap", () => {
  assertEquals(
    causeOf([scenario("x", { injection: { status: "refuted" } })]),
    "not-injected",
  );
});

Deno.test("an unsupported scenario outranks everything else", () => {
  // `unsupported` is a statement about CDP itself, so it holds regardless of
  // what any individual fixture did or did not exercise.
  assertEquals(
    causeOf([
      scenario("x", { injection: { status: "unsupported", requires: "an HTTPS server" } }),
    ]),
    "unsupported",
  );
});

Deno.test("a declared capability gap is a fixture problem", () => {
  assertEquals(
    causeOf([scenario("x", { injection: { status: "unverified", requires: "a WebSocket" } })]),
    "fixture-gap",
  );
});

// The most interesting verdict: we proved the failure was in force and the
// output still did not move. Either the site genuinely does not care, or we
// are not recording the thing that changed.
Deno.test("a confirmed injection with no visible effect is a capture problem", () => {
  assertEquals(
    causeOf([scenario("x", { injection: { status: "confirmed" } })]),
    "not-captured",
  );
});

Deno.test("no probe and no declared gap is untriaged, not excused", () => {
  assertEquals(causeOf([scenario("x", { injection: { status: "unverified" } })]), "unknown");
  assertEquals(causeOf([scenario("x")]), "unknown");
});

// Across fixtures, one refutation is enough. A scenario that injected
// correctly on five fixtures and silently failed on the sixth still has a bug
// worth chasing, and averaging it away would hide exactly the intermittent
// case that is hardest to find by hand.
Deno.test("a single refutation across fixtures outweighs several confirmations", () => {
  assertEquals(
    causeOf([
      scenario("x", { injection: { status: "confirmed" } }),
      scenario("x", { injection: { status: "confirmed" } }),
      scenario("x", { injection: { status: "refuted" } }),
    ]),
    "not-injected",
  );
});

// A probe that errored says nothing either way, so it must not be allowed to
// mask a genuine capability gap declared alongside it.
Deno.test("an errored probe does not mask a declared gap", () => {
  assertEquals(
    causeOf([scenario("x", { injection: { status: "error", requires: "a WebSocket" } })]),
    "fixture-gap",
  );
});

Deno.test("causes are only computed for scenarios inert everywhere", () => {
  const report = classifyInertness([
    { fixture: "a", scenarios: [scenario("baseline"), scenario("offline")] },
    { fixture: "b", scenarios: [scenario("baseline"), scenario("offline")] },
  ]);
  assertEquals([...report.causes.keys()], ["offline"]);
});
