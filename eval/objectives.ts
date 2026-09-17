// objectives.ts — what the autoresearch loop is trying to maximise.
//
// Two objectives, because the repo has two very different things worth
// improving and they are measured in different places:
//
//   harness — the detection logic. Measured by scoring the raw audit report
//             against the rubric (eval/score.ts). This is the number CI
//             already gates on.
//
//   skill   — the prose an agent reads. Measured by scoring the findings
//             report an AGENT produces (eval/findings.ts). The harness
//             objective is blind to this: SKILL.md and the guides never touch
//             an audit.json, so no edit to them can move that score.
//
// Both measure a WORKTREE by shelling out to it. Importing the worktree's
// modules would not work: our own static imports already resolve to this
// checkout, so we would measure the wrong code and never notice.
//
// One coupling worth knowing: the fixture server runs from the main checkout,
// so a worktree's harness audits the MAIN tree's fixtures over HTTP. That is
// only safe because fixtures/ is frozen — if a mutator could edit fixtures,
// the change would not even reach the page being measured, and the round would
// be incoherent as well as dishonest.

import { parseFindings, scoreFindings } from "./findings.ts";
import type { Rubric, Score } from "./score.ts";

export interface Fixture {
  name: string;
  url: string;
  /** Rubric path, relative to the repo root. */
  rubric: string;
}

export interface MeasureContext {
  /** The checkout under test — a worktree, never the user's working tree. */
  dir: string;
  fixtures: Fixture[];
  outDir: string;
  /** Command the skill objective uses to produce a findings report. */
  agentCmd?: string;
}

export interface ObjectiveResult {
  /** The scalar being maximised. Higher is better. */
  value: number;
  perFixture: Record<string, unknown>;
}

export interface Objective {
  name: string;
  /** Path prefixes the mutator may rewrite. Everything else is frozen. */
  mutable: string[];
  /** Handed to the mutator so it knows what it is being asked to do. */
  brief: string;
  measure(ctx: MeasureContext): Promise<ObjectiveResult>;
}

async function run(
  cmd: string[],
  cwd: string,
  env: Record<string, string> = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const child = new Deno.Command(cmd[0], {
    args: cmd.slice(1),
    cwd,
    env: { ...Deno.env.toObject(), ...env },
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await child.output();
  const decode = new TextDecoder();
  return { code, stdout: decode.decode(stdout), stderr: decode.decode(stderr) };
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await Deno.readTextFile(path)) as T;
  } catch {
    return null;
  }
}

/**
 * Detection quality. Value = matched - falsePositives, summed over fixtures.
 *
 * `eval/` and `fixtures/` stay frozen, so the mutator cannot move this by
 * relaxing a rubric. It CAN still move it by special-casing a fixture in the
 * harness, which the guard cannot detect — hold out a fixture if that matters.
 */
export const harnessObjective: Objective = {
  name: "harness",
  mutable: ["harness/"],
  brief: [
    "Improve the resilience harness's detection quality.",
    "You may edit anything under harness/.",
    "The rubrics (eval/) and fixtures (fixtures/) are frozen ground truth.",
    "Do not special-case a fixture: that raises the score without improving",
    "detection, and it is the failure mode this loop is most prone to.",
  ].join("\n"),

  async measure(ctx) {
    let value = 0;
    const perFixture: Record<string, unknown> = {};

    for (const fixture of ctx.fixtures) {
      const outDir = `${ctx.outDir}/${fixture.name}`;
      const result = await run(
        ["./bin/wr", "eval", fixture.url, fixture.rubric, "--out", outDir],
        ctx.dir,
      );
      const score = await readJson<Score>(`${outDir}/score.json`);
      if (!score) {
        // A crashed measurement is not a zero — treat it as strongly negative
        // so a mutation that breaks the harness can never win.
        perFixture[fixture.name] = {
          error: "no score produced",
          exitCode: result.code,
          stderr: result.stderr.slice(-2000),
        };
        value -= 1000;
        continue;
      }
      perFixture[fixture.name] = score;
      value += score.matched - score.falsePositives;
    }
    return { value, perFixture };
  },
};

/**
 * Audit quality as an agent actually delivers it. Requires --agent-cmd: a
 * command that reads the skill, drives the harness however the skill tells it
 * to, and writes a findings report to $WR_FINDINGS_OUT.
 */
export const skillObjective: Objective = {
  name: "skill",
  mutable: ["skills/", "guides/"],
  brief: [
    "Improve the audit skill and its guides so an agent following them",
    "produces a more accurate findings report.",
    "You may edit anything under skills/ and guides/.",
    "The rubrics (eval/) and fixtures (fixtures/) are frozen ground truth,",
    "and you may not change the harness (harness/).",
    "Reporting every possible failure class is penalised, not rewarded:",
    "precision counts as much as recall.",
  ].join("\n"),

  async measure(ctx) {
    if (!ctx.agentCmd) {
      throw new Error(
        "the skill objective needs --agent-cmd: a command that writes a findings\n" +
          "report to $WR_FINDINGS_OUT. See eval/mutators/README.md.",
      );
    }

    let value = 0;
    const perFixture: Record<string, unknown> = {};

    for (const fixture of ctx.fixtures) {
      const outDir = `${ctx.outDir}/${fixture.name}`;
      await Deno.mkdir(outDir, { recursive: true });
      const findingsPath = `${outDir}/findings.json`;

      const result = await run(["sh", "-c", ctx.agentCmd], ctx.dir, {
        WR_FIXTURE_URL: fixture.url,
        WR_FIXTURE_NAME: fixture.name,
        WR_FINDINGS_OUT: findingsPath,
        WR_OUT_DIR: outDir,
        WR_REPO: ctx.dir,
      });

      let contents: string;
      try {
        contents = await Deno.readTextFile(findingsPath);
      } catch {
        perFixture[fixture.name] = {
          error: "agent produced no findings report",
          exitCode: result.code,
          stderr: result.stderr.slice(-2000),
        };
        value -= 1000;
        continue;
      }

      const rubric = JSON.parse(
        await Deno.readTextFile(`${ctx.dir}/${fixture.rubric}`),
      ) as Rubric;

      try {
        const score = scoreFindings(parseFindings(contents), rubric);
        perFixture[fixture.name] = score;
        value += score.matched - score.falsePositives;
      } catch (error) {
        // An unparseable report is a skill failure — the skill is what tells
        // the agent what shape to emit — so it scores, badly, rather than
        // aborting the round.
        perFixture[fixture.name] = { error: `unparseable findings: ${error}` };
        value -= 100;
      }
    }
    return { value, perFixture };
  },
};

export const OBJECTIVES: Record<string, Objective> = {
  harness: harnessObjective,
  skill: skillObjective,
};
