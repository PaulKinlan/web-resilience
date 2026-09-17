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
import { parsePlan } from "./interactions.ts";

const USAGE = `usage: run-scenario <url> [options]

  --scenario <ids>   comma-separated scenario ids (default: baseline)
  --all              run the full matrix (${SCENARIOS.length} scenarios)
  --out <dir>        output directory (default: /tmp/web-resilience-audit)
  --screenshot       capture a PNG per scenario
  --prime            warm the origin first so service workers install
  --plan <file>      interaction plan to drive inside every scenario
                     (our format, or a DevTools Recorder export)
  --derive-plan      survey the DOM on a clean load and synthesise a flow
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

  // Safety net. A stray rejection anywhere in the CDP plumbing used to abort
  // the process and discard an otherwise-complete audit. Report it loudly,
  // but never let it cost the run.
  globalThis.addEventListener("unhandledrejection", (event) => {
    event.preventDefault();
    console.error(`warning: unhandled rejection ignored: ${event.reason}`);
  });

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
  const plan = planPath ? parsePlan(await Deno.readTextFile(planPath)) : undefined;

  const outDir = option(args, "out") ?? "/tmp/web-resilience-audit";

  const report = await runAudit({
    url,
    scenarios,
    outDir,
    screenshot: flag(args, "screenshot"),
    prime: flag(args, "prime"),
    plan,
    derivePlan: flag(args, "derive-plan"),
    onProgress: (r) => {
      if (r.harnessError) {
        console.log(`[${r.scenario}] HARNESS-ERROR ${r.harnessError}`);
        return;
      }
      const injection = (r.extra.injectionErrors as string[] | undefined) ?? [];
      const flow = r.extra.interactions as
        | { steps: Array<{ ok: boolean }>; failedAt: number | null }
        | undefined;
      const flowNote = flow
        ? ` flow=${flow.steps.filter((s) => s.ok).length}/${flow.steps.length}` +
          (flow.failedAt !== null ? ` BROKE@${flow.failedAt}` : "")
        : "";
      console.log(
        `[${r.scenario}] nav=${r.navSucceeded} failures=${r.networkFailures.length} ` +
          `consoleErrors=${r.consoleErrors.length} crash=${r.crashDetected}` +
          flowNote +
          (injection.length ? ` INJECTION-FAILED=${injection.length}` : ""),
      );
    },
  });


  const outPath = `${outDir}/audit.json`;
  await Deno.writeTextFile(outPath, JSON.stringify(report, null, 2));
  console.log(`wrote ${outPath}`);
  Deno.exit(0);
}
