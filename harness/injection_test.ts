// injection_test.ts — the judgement calls in verifyInjection.
//
// These are pinned because each one is a decision about what the harness is
// allowed to accuse itself of. Getting them wrong in either direction is
// expensive: a false `refuted` sends someone hunting a harness bug that isn't
// there, and a false `confirmed` re-opens the exact hole this mechanism was
// built to close.

import { assertEquals } from "@std/assert";
import { verifyInjection } from "./audit.ts";
import type { Session } from "./interactions.ts";
import type { Scenario } from "./scenarios.ts";
import { SCENARIOS } from "./scenarios.ts";

/** A page that answers every Runtime.evaluate with `value`. */
const pageReturning = (value: unknown): Session => () =>
  Promise.resolve({ result: { value } });

/** A page whose probe throws inside the page (CDP reports exceptionDetails). */
const pageThrowing = (text: string): Session => () =>
  Promise.resolve({ result: {}, exceptionDetails: { text } });

/** A transport that fails outright — socket closed, target gone. */
const deadTransport = (): Session => () => Promise.reject(new Error("target closed"));

const spec = (over: Partial<Scenario>) =>
  ({ id: "baseline", label: "", description: "", commands: [], ...over }) as Scenario;

Deno.test("a probe that returns true confirms the injection", async () => {
  const got = await verifyInjection(pageReturning(true), spec({ verify: "x" }));
  assertEquals(got.status, "confirmed");
});

Deno.test("a probe that returns false refutes it", async () => {
  const got = await verifyInjection(pageReturning(false), spec({ verify: "x" }));
  assertEquals(got.status, "refuted");
  assertEquals(got.value, false);
});

// Only `true` confirms. A probe that returns a number, a string or undefined
// has not answered the question, and truthiness coercion would quietly turn
// "the expression was malformed and evaluated to a string" into a pass.
Deno.test("only a literal true confirms; a truthy non-boolean does not", async () => {
  const got = await verifyInjection(pageReturning("yes"), spec({ verify: "x" }));
  assertEquals(got.status, "refuted");
});

// The important one. `refuted` is an accusation against the harness, so it has
// to mean the page answered "no" — not that the page was unreachable. Offline
// and crashed scenarios fail every probe, and none of that is evidence the
// injection missed.
Deno.test("a probe that throws in the page is an error, never a refutation", async () => {
  const got = await verifyInjection(pageThrowing("ReferenceError: foo"), spec({ verify: "x" }));
  assertEquals(got.status, "error");
  assertEquals(got.detail, "ReferenceError: foo");
});

Deno.test("a dead transport is an error, never a refutation", async () => {
  const got = await verifyInjection(deadTransport(), spec({ verify: "x" }));
  assertEquals(got.status, "error");
});

Deno.test("a scenario with no probe is unverified, not refuted", async () => {
  const got = await verifyInjection(pageReturning(true), spec({}));
  assertEquals(got.status, "unverified");
});

// `unsupported` is declared in the matrix and must short-circuit: the page is
// never asked, because there is nothing to ask about.
Deno.test("an unsupported scenario never reaches the page", async () => {
  let asked = false;
  const sess: Session = () => {
    asked = true;
    return Promise.resolve({ result: { value: true } });
  };
  const got = await verifyInjection(sess, spec({ unsupported: "no CDP command exists" }));
  assertEquals(got.status, "unsupported");
  assertEquals(got.detail, "no CDP command exists");
  assertEquals(asked, false);
});

Deno.test("`requires` is carried through to the report", async () => {
  const got = await verifyInjection(pageReturning(true), spec({ requires: "a WebSocket" }));
  assertEquals(got.requires, "a WebSocket");
});

// A scenario that declares itself unsupported but still ships commands would
// run those commands and then report "not tested", which is the same kind of
// mismatch between claim and behaviour that the field exists to eliminate.
Deno.test("unsupported scenarios carry no commands", () => {
  const offenders = SCENARIOS
    .filter((s) => s.unsupported && s.commands.length > 0)
    .map((s) => s.id);
  assertEquals(offenders, []);
});

// Guards against the failure mode this whole mechanism was built for: a
// scenario that injects nothing at all. `incognito` and `cert-error` are the
// only legitimate cases — the first is applied by creating a separate browser
// context rather than by a command, the second is explicitly unsupported.
Deno.test("every scenario either injects something or says why not", () => {
  const silent = SCENARIOS
    .filter((s) => s.commands.length === 0 && !s.failAllWith && !s.incognito && !s.unsupported)
    .map((s) => s.id);
  assertEquals(silent, []);
});
