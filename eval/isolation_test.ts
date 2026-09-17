import { assertEquals } from "@std/assert";
import { checkPaths, parsePorcelainZ, policy } from "./isolation.ts";

Deno.test("parsePorcelainZ reads modified, added and untracked entries", () => {
  const out = " M skills/web-resilience-audit/SKILL.md\0A  guides/new.md\0?? guides/draft.md\0";
  assertEquals(parsePorcelainZ(out), [
    "skills/web-resilience-audit/SKILL.md",
    "guides/new.md",
    "guides/draft.md",
  ]);
});

Deno.test("parsePorcelainZ keeps both sides of a rename", () => {
  // git emits the destination in the entry and the source as the next field.
  const out = "R  guides/new-name.md\0guides/old-name.md\0 M skills/a.md\0";
  assertEquals(parsePorcelainZ(out), [
    "guides/new-name.md",
    "guides/old-name.md",
    "skills/a.md",
  ]);
});

Deno.test("parsePorcelainZ survives a newline inside a filename", () => {
  // The reason for -z. A line-based parser would split this into two paths and
  // the second fragment would not match any frozen prefix.
  const out = " M guides/we\nird.md\0";
  assertEquals(parsePorcelainZ(out), ["guides/we\nird.md"]);
});

Deno.test("changes inside the mutable set pass", () => {
  const result = checkPaths(
    ["skills/web-resilience-audit/SKILL.md", "guides/offline.md"],
    policy(["skills/", "guides/"]),
  );
  assertEquals(result.ok, true);
  assertEquals(result.violations, []);
});

Deno.test("editing a rubric fails the round", () => {
  const result = checkPaths(
    ["skills/a.md", "eval/rubrics/resilient-club.json"],
    policy(["skills/"]),
  );
  assertEquals(result.ok, false);
  assertEquals(result.violations, ["eval/rubrics/resilient-club.json"]);
});

Deno.test("editing a fixture fails the round", () => {
  const result = checkPaths(["fixtures/resilient-club/app.js"], policy(["harness/"]));
  assertEquals(result.ok, false);
  assertEquals(result.violations, ["fixtures/resilient-club/app.js"]);
});

Deno.test("an objective cannot unfreeze the ground truth", () => {
  // Even if an objective wrongly declares eval/ mutable, alwaysFrozen wins.
  const result = checkPaths(["eval/score.ts"], policy(["eval/", "skills/"]));
  assertEquals(result.ok, false);
  assertEquals(result.violations, ["eval/score.ts"]);
});

Deno.test("changes outside every declared prefix fail", () => {
  const result = checkPaths(["harness/audit.ts", ".github/workflows/ci.yml"], policy(["skills/"]));
  assertEquals(result.ok, false);
  assertEquals(result.violations, [".github/workflows/ci.yml", "harness/audit.ts"]);
});

Deno.test("a prefix does not match a sibling with the same leading characters", () => {
  // "skills-backup/" must not be treated as inside "skills/".
  const result = checkPaths(["skills-backup/SKILL.md"], policy(["skills/"]));
  assertEquals(result.ok, false);
  assertEquals(result.violations, ["skills-backup/SKILL.md"]);
});

Deno.test("violations are deduped and sorted", () => {
  const result = checkPaths(
    ["eval/b.ts", "eval/a.ts", "eval/b.ts"],
    policy(["skills/"]),
  );
  assertEquals(result.violations, ["eval/a.ts", "eval/b.ts"]);
});
