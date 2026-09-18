// run-eval.ts — the eval loop: fixture → audit → score vs rubric → (fix) → re-audit → delta.
// This is the ONLY place ground truth lives relative to the skills. The audit +
// fix skills never read the rubric; they only see URLs + CDP.
//
//   deno run -A eval/run-eval.ts <fixture-url> <rubric-json> [--out <dir>] [--screenshot]
//
// The audit itself comes from harness/audit.ts — the same code path the skill
// runs. Previously this file carried its own copy of the scenario runner, so
// the rubric was scored against a thinner report (no perf, fonts, permissions
// or screenshots) than the skill ever produced.

import { runAudit } from "../harness/audit.ts";
import { type Rubric, scoreAudit, type Score } from "./score.ts";

export type { Rubric };


export async function runEval(
  url: string,
  rubricPath: string,
  outDir = "/tmp/web-resilience-eval",
  options: { screenshot?: boolean } = {},
): Promise<Score> {
  const rubric = JSON.parse(await Deno.readTextFile(rubricPath)) as Rubric;

  const report = await runAudit({
    url,
    outDir,
    screenshot: options.screenshot ?? false,
    // Fixtures ship service workers; without priming, offline/dns scenarios
    // would score a cold cache and report "no shell" for a site that has one.
    prime: true,
  });

  await Deno.writeTextFile(
    `${outDir}/audit.json`,
    JSON.stringify(report, null, 2),
  );
  const score = scoreAudit(report, rubric);
  // Persisted, not just printed: the autoresearch loop needs to read this back
  // from a subprocess, and scraping stdout would be at the mercy of progress
  // output.
  await Deno.writeTextFile(
    `${outDir}/score.json`,
    JSON.stringify(score, null, 2),
  );
  return score;
}

if (import.meta.main) {
  const [url, rubricPath] = Deno.args;
  if (!url || !rubricPath) {
    console.error(
      "usage: run-eval <url> <rubric.json> [--out <dir>] [--screenshot]\n" +
        "                [--expect <matched>] [--max-false-positives <n>]",
    );
    Deno.exit(1);
  }
  const optionValue = (name: string): string | undefined => {
    const index = Deno.args.indexOf(`--${name}`);
    return index === -1 ? undefined : Deno.args[index + 1];
  };

  const outDir = optionValue("out") ?? "/tmp/web-resilience-eval";
  const score = await runEval(url, rubricPath, outDir, {
    screenshot: Deno.args.includes("--screenshot"),
  });
  console.log(JSON.stringify(score, null, 2));

  // Regression gate. Without this the eval is decorative in CI: it would
  // report a collapsed score and still exit 0.
  const failures: string[] = [];

  // An incomplete matrix invalidates the whole measurement, and it does NOT
  // show up in `matched`: a rubric whose findings all sit in the scenarios
  // that happened to run will report a clean pass over a half-finished audit.
  // Observed for real — 24 of 46 scenarios missing, still 5/5.
  // Strict by default; opt out deliberately when auditing a flaky target.
  const maxUnrun = Number(optionValue("max-unrun") ?? 0);
  if (score.scenariosUnrun > maxUnrun) {
    failures.push(
      `${score.scenariosUnrun} scenario(s) did not run (allowed ${maxUnrun}) — ` +
        `the matrix is incomplete, so this score is not meaningful`,
    );
  }

  const expect = optionValue("expect");
  if (expect !== undefined && score.matched < Number(expect)) {
    failures.push(`matched ${score.matched} < expected ${expect}`);
  }
  const maxFalsePositives = optionValue("max-false-positives");
  if (
    maxFalsePositives !== undefined &&
    score.falsePositives > Number(maxFalsePositives)
  ) {
    failures.push(
      `falsePositives ${score.falsePositives} > allowed ${maxFalsePositives}`,
    );
  }
  if (failures.length) {
    console.error(`\nREGRESSION: ${failures.join("; ")}`);
    Deno.exit(1);
  }
  Deno.exit(0);
}

