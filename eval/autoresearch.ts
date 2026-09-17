// autoresearch.ts — a competitive improvement loop.
//
//   ./bin/wr autoresearch --objective harness --rounds 5 --mutator './my-mutator.sh'
//
// Each round: branch a worktree from the current champion, let a mutator edit
// it, enforce that it only touched what it was allowed to, measure, and keep
// the result only if it beats the champion.
//
// Three properties this design exists to guarantee:
//
//  1. The mutator cannot edit the scorer or the fixtures. eval/ and fixtures/
//     are frozen (eval/isolation.ts). Without that the loop optimises its own
//     ruler and reports a win.
//  2. Nothing touches the user's working tree. Rounds run in git worktrees and
//     the winner is left on a ref for review, never committed to the branch.
//  3. A candidate must be strictly better to win. Measurement is noisy — real
//     browsers, real timing — so ties keep the incumbent rather than letting
//     the champion drift on noise.

import { checkWorktree, describeViolations, policy } from "./isolation.ts";
import { type Fixture, OBJECTIVES, type Objective } from "./objectives.ts";

const CHAMPION_REF = "refs/autoresearch/champion";

interface Round {
  round: number;
  value: number;
  champion: boolean;
  sha?: string;
  status: "measured" | "isolation-violation" | "mutator-failed" | "no-change";
  note?: string;
  perFixture?: Record<string, unknown>;
}

async function git(
  args: string[],
  cwd = ".",
): Promise<{ code: number; stdout: string; stderr: string }> {
  const { code, stdout, stderr } = await new Deno.Command("git", {
    args,
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const decode = new TextDecoder();
  return {
    code,
    stdout: decode.decode(stdout).trim(),
    stderr: decode.decode(stderr).trim(),
  };
}

async function gitOrThrow(args: string[], cwd = "."): Promise<string> {
  const result = await git(args, cwd);
  if (result.code !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
  return result.stdout;
}

function option(name: string): string | undefined {
  const index = Deno.args.indexOf(`--${name}`);
  return index === -1 ? undefined : Deno.args[index + 1];
}

/** Run the mutator inside the worktree, handing it the round's context. */
async function mutate(
  command: string,
  worktree: string,
  context: unknown,
): Promise<{ ok: boolean; stderr: string }> {
  const child = new Deno.Command("sh", {
    args: ["-c", command],
    cwd: worktree,
    env: { ...Deno.env.toObject(), WR_REPO: worktree },
    stdin: "piped",
    stdout: "inherit",
    stderr: "piped",
  }).spawn();

  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode(JSON.stringify(context, null, 2)));
  await writer.close();

  const { code, stderr } = await child.output();
  return { ok: code === 0, stderr: new TextDecoder().decode(stderr) };
}

export async function main() {
  const objectiveName = option("objective") ?? "harness";
  const objective: Objective | undefined = OBJECTIVES[objectiveName];
  if (!objective) {
    console.error(
      `unknown objective "${objectiveName}" — expected one of: ${Object.keys(OBJECTIVES).join(", ")}`,
    );
    Deno.exit(1);
  }

  const rounds = Number(option("rounds") ?? 3);
  const port = option("port") ?? "8080";
  const mutator = option("mutator");
  const agentCmd = option("agent-cmd");
  const workDir = option("work-dir") ?? "/tmp/wr-autoresearch";
  const keepWorktrees = Deno.args.includes("--keep-worktrees");

  // All hermetic fixtures. A wider set is the main defence against a mutation
  // that raises the score by special-casing one page: with two fixtures the
  // ceiling was 10, which is not much to optimise into.
  const fixtures: Fixture[] = [
    "resilient-club",
    "reference",
    "spa-hydration",
    "sw-dependency",
    "csp-report-only",
  ].map((name) => ({
    name,
    url: `http://127.0.0.1:${port}/${name}/`,
    rubric: `eval/rubrics/${name}.json`,
  }));

  // third-party needs the public internet (block-third-party matches real CDN
  // hostnames). Opt-in, so a flaky network cannot look like a regression.
  if (Deno.args.includes("--include-network-fixtures")) {
    fixtures.push({
      name: "third-party",
      url: `http://127.0.0.1:${port}/third-party/`,
      rubric: "eval/rubrics/third-party.json",
    });
  }

  const repoRoot = await gitOrThrow(["rev-parse", "--show-toplevel"]);
  await Deno.mkdir(workDir, { recursive: true });

  console.log(`objective : ${objective.name}`);
  console.log(`mutable   : ${objective.mutable.join(", ")}`);
  console.log(`frozen    : eval/, fixtures/, and everything else`);
  console.log(`rounds    : ${rounds}`);
  console.log(`mutator   : ${mutator ?? "(none — measuring the baseline only)"}`);
  console.log("");

  // Baseline. Measured in a worktree too, so the number is comparable with
  // every candidate and is not affected by uncommitted local edits.
  let champion = await gitOrThrow(["rev-parse", "HEAD"]);
  const baselineTree = `${workDir}/baseline`;
  await removeWorktree(repoRoot, baselineTree);
  await gitOrThrow(["worktree", "add", "--detach", baselineTree, champion], repoRoot);

  const baseline = await objective.measure({
    dir: baselineTree,
    fixtures,
    outDir: `${workDir}/out/baseline`,
    agentCmd,
  });
  let championValue = baseline.value;
  console.log(`baseline (${champion.slice(0, 8)}): ${championValue}`);
  console.log(JSON.stringify(baseline.perFixture, null, 2));
  if (!keepWorktrees) await removeWorktree(repoRoot, baselineTree);

  const history: Round[] = [{
    round: 0,
    value: championValue,
    champion: true,
    sha: champion,
    status: "measured",
    note: "baseline",
    perFixture: baseline.perFixture,
  }];

  for (let i = 1; i <= rounds && mutator; i++) {
    console.log(`\n=== round ${i} ===`);
    const worktree = `${workDir}/round-${i}`;
    await removeWorktree(repoRoot, worktree);
    await gitOrThrow(["worktree", "add", "--detach", worktree, champion], repoRoot);

    const context = {
      round: i,
      objective: objective.name,
      brief: objective.brief,
      mutablePaths: objective.mutable,
      frozenPaths: ["eval/", "fixtures/"],
      championValue,
      history: history.map(({ perFixture: _omit, ...rest }) => rest),
      lastResult: history[history.length - 1]?.perFixture,
    };

    const mutation = await mutate(mutator, worktree, context);
    if (!mutation.ok) {
      console.error(`round ${i}: mutator failed\n${mutation.stderr.slice(-2000)}`);
      history.push({ round: i, value: championValue, champion: false, status: "mutator-failed" });
      if (!keepWorktrees) await removeWorktree(repoRoot, worktree);
      continue;
    }

    // The guard. A round that touched frozen paths is not scored at all — a
    // score derived from an edited rubric is worse than no score.
    const isolation = await checkWorktree(worktree, policy(objective.mutable));
    if (!isolation.ok) {
      console.error(describeViolations(isolation));
      history.push({
        round: i,
        value: championValue,
        champion: false,
        status: "isolation-violation",
        note: isolation.violations.join(", "),
      });
      if (!keepWorktrees) await removeWorktree(repoRoot, worktree);
      continue;
    }

    if (isolation.changed.length === 0) {
      console.log(`round ${i}: mutator changed nothing`);
      history.push({ round: i, value: championValue, champion: false, status: "no-change" });
      if (!keepWorktrees) await removeWorktree(repoRoot, worktree);
      continue;
    }

    console.log(`round ${i}: changed ${isolation.changed.length} file(s)`);
    await gitOrThrow(["add", "-A"], worktree);
    await gitOrThrow(
      ["commit", "-q", "-m", `autoresearch round ${i} (${objective.name})`],
      worktree,
    );
    const sha = await gitOrThrow(["rev-parse", "HEAD"], worktree);

    const result = await objective.measure({
      dir: worktree,
      fixtures,
      outDir: `${workDir}/out/round-${i}`,
      agentCmd,
    });

    // Strictly greater: a tie is noise, and promoting on noise makes the
    // champion wander without improving anything.
    const won = result.value > championValue;
    console.log(
      `round ${i}: ${result.value} vs champion ${championValue} — ${won ? "WIN" : "discarded"}`,
    );
    console.log(JSON.stringify(result.perFixture, null, 2));

    if (won) {
      champion = sha;
      championValue = result.value;
      // Park it on a ref. The worktree's commit is otherwise unreachable and
      // would be garbage collected out from under us.
      await gitOrThrow(["update-ref", CHAMPION_REF, sha], repoRoot);
    }

    history.push({
      round: i,
      value: result.value,
      champion: won,
      sha,
      status: "measured",
      perFixture: result.perFixture,
    });
    if (!keepWorktrees) await removeWorktree(repoRoot, worktree);
  }

  const summaryPath = `${workDir}/history.json`;
  await Deno.writeTextFile(
    summaryPath,
    JSON.stringify({ objective: objective.name, championValue, champion, history }, null, 2),
  );

  console.log("\n=== summary ===");
  for (const round of history) {
    const mark = round.champion ? "*" : " ";
    console.log(
      `${mark} round ${String(round.round).padStart(2)}  value ${String(round.value).padStart(4)}  ${round.status}${
        round.note ? ` — ${round.note}` : ""
      }`,
    );
  }
  console.log(`\nhistory: ${summaryPath}`);

  const baselineSha = history[0].sha;
  if (champion !== baselineSha) {
    console.log(`\nchampion: ${champion.slice(0, 8)} (ref ${CHAMPION_REF}), +${championValue - history[0].value}`);
    console.log("Nothing has been applied to your working tree. To review:");
    console.log(`  git diff ${baselineSha?.slice(0, 8)}..${CHAMPION_REF}`);
    console.log(`To take it:`);
    console.log(`  git cherry-pick ${CHAMPION_REF}`);
  } else {
    console.log("\nno candidate beat the baseline; nothing to apply");
  }
  Deno.exit(0);
}

async function removeWorktree(repoRoot: string, path: string) {
  // --force because a failed round can leave the worktree dirty.
  await git(["worktree", "remove", "--force", path], repoRoot);
  await Deno.remove(path, { recursive: true }).catch(() => {});
}

if (import.meta.main) await main();
