import { assertEquals, assertThrows } from "@std/assert";
import { parseFindings, scoreFindings } from "./findings.ts";
import type { Rubric } from "./score.ts";

const rubric: Rubric = {
  fixture: "test",
  version: 1,
  expectedFindings: [
    {
      id: "no-offline-shell",
      scenario: "offline",
      class: "offline-fallback",
      severity: "critical",
      signal: "ERR_INTERNET_DISCONNECTED",
      expected: true,
      notPresent: true,
    },
    {
      id: "js-spof",
      scenario: "block-js",
      class: "js-failure",
      severity: "major",
      signal: "app.js",
      expected: true,
    },
    {
      // The site handles this correctly; claiming otherwise is a false claim.
      id: "fonts-ok",
      scenario: "block-fonts",
      class: "font-display",
      severity: "minor",
      signal: "swap",
      expected: false,
    },
  ],
};

Deno.test("a perfect report scores 2/2 with no false positives", () => {
  const score = scoreFindings({
    findings: [
      { scenario: "offline", class: "offline-fallback", severity: "critical" },
      { scenario: "block-js", class: "js-failure", severity: "major" },
    ],
  }, rubric);
  assertEquals(score.matched, 2);
  assertEquals(score.expected, 2);
  assertEquals(score.missed, []);
  assertEquals(score.falsePositives, 0);
  assertEquals(score.precision, 1);
  assertEquals(score.recall, 1);
});

Deno.test("a missed finding is named", () => {
  const score = scoreFindings({
    findings: [{ scenario: "offline", class: "offline-fallback" }],
  }, rubric);
  assertEquals(score.matched, 1);
  assertEquals(score.missed, ["js-spof"]);
  assertEquals(score.recall, 0.5);
});

Deno.test("claiming a failure the rubric says is handled is a false positive", () => {
  const score = scoreFindings({
    findings: [
      { scenario: "offline", class: "offline-fallback" },
      { scenario: "block-js", class: "js-failure" },
      { scenario: "block-fonts", class: "font-display" },
    ],
  }, rubric);
  assertEquals(score.matched, 2);
  assertEquals(score.falseClaims, ["fonts-ok"]);
  assertEquals(score.falsePositives, 1);
  // 2 of 3 claims were right.
  assertEquals(score.precision, 0.67);
});

Deno.test("shotgunning every class is penalised, not rewarded", () => {
  // The exploit the extras rule exists to close: report everything, match
  // everything. Recall is perfect but precision collapses.
  const score = scoreFindings({
    findings: [
      { scenario: "offline", class: "offline-fallback" },
      { scenario: "block-js", class: "js-failure" },
      { scenario: "offline", class: "js-failure" },
      { scenario: "block-css", class: "css-failure" },
      { scenario: "dns-fail", class: "dns-fallback" },
    ],
  }, rubric);
  assertEquals(score.matched, 2);
  assertEquals(score.recall, 1);
  assertEquals(score.extras.length, 3);
  assertEquals(score.falsePositives, 3);
  assertEquals(score.precision, 0.4);
});

Deno.test("extras can be tolerated when the rubric is known to be partial", () => {
  const score = scoreFindings({
    findings: [
      { scenario: "offline", class: "offline-fallback" },
      { scenario: "block-js", class: "js-failure" },
      { scenario: "dns-fail", class: "dns-fallback" },
    ],
  }, rubric, { strictExtras: false });
  assertEquals(score.extras, ["dns-fail/dns-fallback"]);
  assertEquals(score.falsePositives, 0);
  assertEquals(score.precision, 1);
});

Deno.test("duplicate findings do not inflate the score", () => {
  const score = scoreFindings({
    findings: [
      { scenario: "offline", class: "offline-fallback" },
      { scenario: "offline", class: "offline-fallback" },
      { scenario: "offline", class: "offline-fallback" },
    ],
  }, rubric);
  assertEquals(score.matched, 1);
  assertEquals(score.extras, []);
});

Deno.test("severity mismatch is recorded but does not break the match", () => {
  const score = scoreFindings({
    findings: [{ scenario: "offline", class: "offline-fallback", severity: "info" }],
  }, rubric);
  assertEquals(score.matched, 1);
  assertEquals(score.severityMismatches.length, 1);
});

Deno.test("an empty report scores zero rather than throwing", () => {
  const score = scoreFindings({ findings: [] }, rubric);
  assertEquals(score.matched, 0);
  assertEquals(score.recall, 0);
  assertEquals(score.precision, 0);
});

Deno.test("parseFindings unwraps a markdown fence", () => {
  const report = parseFindings('```json\n{"findings":[{"scenario":"offline","class":"x"}]}\n```');
  assertEquals(report.findings.length, 1);
});

Deno.test("parseFindings accepts a bare array", () => {
  assertEquals(parseFindings('[{"scenario":"offline","class":"x"}]').findings.length, 1);
});

Deno.test("parseFindings rejects a report with no findings array", () => {
  assertThrows(() => parseFindings('{"summary":"all good"}'));
});
