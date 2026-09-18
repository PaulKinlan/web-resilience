// Scenario inertness auditor.
//
// A scenario exists to make something happen. If its report is
// indistinguishable from the baseline's, then either the injection silently
// failed or nothing is listening for what it produces. Either way the scenario
// is decorative — and, the dangerous part, it reports a clean pass while being
// decorative. An inert scenario and a scenario the site survives look exactly
// the same from the outside.
//
// Four scenarios have already been caught this way one at a time:
//   - `tab-crash`     crashed about:blank, then loaded the site cleanly
//   - `sw-unregister` called ServiceWorker.enable and nothing else
//   - anything Log-only  (Log.entryAdded was never subscribed)
//   - `offline`/`dns-fail` on service-worker sites (shaping never reached the
//     worker, so the "offline" page was served live from the network)
//
// Each was found by looking closely at one scenario. This does it exhaustively
// over audit.json files that already exist, so it costs no browser time.
//
// The distinction that matters is the last column:
//   inert on SOME fixtures  — usually legitimate. A resilient site is supposed
//                             to survive offline; that is the finding.
//   inert on EVERY fixture  — suspicious. No fixture we have can tell the
//                             difference between this scenario running and it
//                             not running at all.
//
// Usage: wr inert <audit-dir>...     (each dir containing an audit.json)

interface ScenarioReport {
  scenario: string;
  navSucceeded: boolean;
  crashDetected: boolean;
  finalUrl: string | null;
  networkFailures: Array<Record<string, unknown>>;
  consoleErrors: Array<Record<string, unknown>>;
  uncaughtExceptions: Array<Record<string, unknown>>;
  browserLogs: Array<Record<string, unknown>>;
  fonts?: unknown;
  pageTextSample?: string;
  extra?: Record<string, unknown>;
  harnessError?: string;
}

type Verdict = "differs" | "identical" | "unrun";

/**
 * Everything observable and deterministic about a scenario run.
 *
 * Deliberately excludes `perf` and `durationMs`. Those differ on every run
 * regardless of what was injected, so including them would make every single
 * scenario look alive and the report would always be empty — a check that can
 * never fail is worse than no check, because it looks like reassurance.
 */
export function fingerprint(s: ScenarioReport): string {
  const net = s.networkFailures
    .map((f) => `${f.resourceType}:${f.errorText ?? f.blockedReason}`)
    .sort();
  const consoleErrors = s.consoleErrors
    .map((c) => JSON.stringify(c.args ?? c).slice(0, 200)).sort();
  const exceptions = s.uncaughtExceptions
    .map((e) => JSON.stringify(e).slice(0, 200)).sort();
  const logs = s.browserLogs
    .map((l) => `${l.source}/${l.level}/${String(l.text ?? "").slice(0, 120)}`)
    .sort();
  return JSON.stringify({
    nav: s.navSucceeded,
    crash: s.crashDetected,
    finalUrl: s.finalUrl,
    net,
    console: consoleErrors,
    exceptions,
    logs,
    fonts: s.fonts,
    text: (s.pageTextSample ?? "").trim(),
    extra: s.extra ?? null,
  });
}

export interface InertnessReport {
  fixtures: string[];
  /** scenario id → fixture name → verdict */
  verdicts: Map<string, Map<string, Verdict>>;
  /** Indistinguishable from baseline on every fixture that ran it. */
  inertEverywhere: string[];
  /** Indistinguishable on at least one fixture, but not all. */
  inertSomewhere: string[];
}

export function classifyInertness(
  audits: Array<{ fixture: string; scenarios: ScenarioReport[] }>,
): InertnessReport {
  const verdicts = new Map<string, Map<string, Verdict>>();

  for (const { fixture, scenarios } of audits) {
    const baseline = scenarios.find((s) => s.scenario === "baseline");
    // Without a baseline there is nothing to compare against. Skipping is
    // honest; guessing a baseline would invent the answer.
    if (!baseline) continue;
    const base = fingerprint(baseline);
    for (const s of scenarios) {
      if (s.scenario === "baseline") continue;
      const row = verdicts.get(s.scenario) ?? new Map<string, Verdict>();
      row.set(
        fixture,
        s.harnessError
          ? "unrun"
          : fingerprint(s) === base
          ? "identical"
          : "differs",
      );
      verdicts.set(s.scenario, row);
    }
  }

  const fixtures = audits.map((a) => a.fixture);
  const inertEverywhere: string[] = [];
  const inertSomewhere: string[] = [];
  for (const [id, row] of [...verdicts].sort()) {
    const identical = [...row.values()].filter((v) => v === "identical").length;
    const ran = [...row.values()].filter((v) => v !== "unrun").length;
    if (ran === 0) continue;
    if (identical === ran) inertEverywhere.push(id);
    else if (identical > 0) inertSomewhere.push(id);
  }

  return { fixtures, verdicts, inertEverywhere, inertSomewhere };
}

function fixtureName(dir: string): string {
  // Sweep output dirs are conventionally /tmp/v8-<fixture>; strip the version
  // prefix so successive sweeps produce comparable tables.
  return dir.replace(/\/+$/, "").split("/").pop()!.replace(/^v\d+-/, "");
}

if (import.meta.main) {
  const dirs = Deno.args.filter((a) => !a.startsWith("--"));
  const strict = Deno.args.includes("--strict");

  if (!dirs.length) {
    console.error("usage: wr inert <audit-dir>... [--strict]");
    console.error();
    console.error(
      "  --strict   exit 1 if any scenario is inert on every fixture",
    );
    Deno.exit(2);
  }

  const audits: Array<{ fixture: string; scenarios: ScenarioReport[] }> = [];
  for (const dir of dirs) {
    try {
      const report = JSON.parse(await Deno.readTextFile(`${dir}/audit.json`));
      audits.push({ fixture: fixtureName(dir), scenarios: report.scenarios });
    } catch (error) {
      console.error(`skipping ${dir}: ${error}`);
    }
  }
  if (!audits.length) {
    console.error("no readable audits");
    Deno.exit(2);
  }

  const { fixtures, verdicts, inertEverywhere, inertSomewhere } =
    classifyInertness(audits);

  const width = 30;
  const col = 9;
  console.log(
    `\n${"scenario".padEnd(width)}${
      fixtures.map((f) => f.slice(0, col - 1).padEnd(col)).join("")
    }`,
  );
  console.log("-".repeat(width + fixtures.length * col));
  for (const [id, row] of [...verdicts].sort()) {
    const cells = fixtures.map((f) => {
      const v = row.get(f);
      return (v === "differs" ? "." : v === "identical" ? "INERT" : "?")
        .padEnd(col);
    });
    console.log(`${id.padEnd(width)}${cells.join("")}`);
  }

  console.log(`\n.      differs from baseline — the scenario did something`);
  console.log(`INERT  indistinguishable from baseline`);
  console.log(`?      did not run\n`);
  console.log(
    `inert on EVERY fixture (${inertEverywhere.length}): ${
      inertEverywhere.join(", ") || "none"
    }`,
  );
  console.log(
    `inert on SOME fixtures (${inertSomewhere.length}): ${
      inertSomewhere.join(", ") || "none"
    }`,
  );
  console.log(
    `\n"some" is usually legitimate — surviving offline is the finding.`,
  );
  console.log(
    `"every" means no fixture can tell this scenario from not running it.`,
  );

  if (strict && inertEverywhere.length) Deno.exit(1);
}
