// run-scenario.ts — CLI entry: audit ONE url through ONE (or all) scenarios.
//
//   wr audit https://example.com --all --screenshot --out /tmp/audit
//   wr audit https://example.com --scenario offline,dns-fail
//
// Emits a JSON AuditReport + optional screenshots. The report is the audit
// skill's raw input; the eval framework scores the same structure.
//
// The scenario execution itself lives in audit.ts, shared with the eval.

import { runAudit } from "./audit.ts";
import { SCENARIOS } from "./scenarios.ts";
import type { InteractionPlan } from "./interactions.ts";

const USAGE = `usage: run-scenario <url> [options]

  --scenario <ids>   comma-separated scenario ids (default: baseline)
  --all              run the full matrix (${SCENARIOS.length} scenarios)
  --out <dir>        output directory (default: /tmp/web-resilience-audit)
  --screenshot       capture a PNG per scenario
  --prime            warm the origin first so service workers install
  --plan <file>      JSON interaction plan to drive inside every scenario
  --list             print the scenario matrix and exit`;

function flag(args: string[], name: string): boolean {
  return args.includes(`--${name}`);
}

/** Read `--name value`, returning undefined when the flag is absent. */
function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    console.error(`error: --${name} requires a value`);
    Deno.exit(1);
  }
  return value;
}

if (import.meta.main) {
  const args = Deno.args;

  if (flag(args, "list")) {
    for (const s of SCENARIOS) console.log(`${s.id.padEnd(26)} ${s.label}`);
    Deno.exit(0);
  }

  const url = args[0];
  if (!url || url.startsWith("--")) {
    console.error(USAGE);
    Deno.exit(1);
  }

  const requested = option(args, "scenario");
  const scenarios = flag(args, "all")
    ? SCENARIOS.map((s) => s.id)
    : (requested ?? "baseline").split(",").map((s) => s.trim()).filter(Boolean);

  const unknown = scenarios.filter((id) => !SCENARIOS.some((s) => s.id === id));
  if (unknown.length) {
    console.error(`error: unknown scenario(s): ${unknown.join(", ")}`);
    console.error("run with --list to see the matrix");
    Deno.exit(1);
  }

  const planPath = option(args, "plan");
  const plan = planPath
    ? JSON.parse(await Deno.readTextFile(planPath)) as InteractionPlan
    : undefined;

  const outDir = option(args, "out") ?? "/tmp/web-resilience-audit";

  const report = await runAudit({
    url,
    scenarios,
    outDir,
    screenshot: flag(args, "screenshot"),
    prime: flag(args, "prime"),
    plan,
    onProgress: (r) => {
      const injection = (r.extra.injectionErrors as string[] | undefined) ?? [];
      console.log(
        `[${r.scenario}] nav=${r.navSucceeded} failures=${r.networkFailures.length} ` +
          `consoleErrors=${r.consoleErrors.length} crash=${r.crashDetected}` +
          (injection.length ? ` INJECTION-FAILED=${injection.length}` : ""),
      );
    },
  });

  const outPath = `${outDir}/audit.json`;
  await Deno.writeTextFile(outPath, JSON.stringify(report, null, 2));
  console.log(`wrote ${outPath}`);
  Deno.exit(0);
}
