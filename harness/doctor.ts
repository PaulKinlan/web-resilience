// doctor.ts — answer "will this work on this machine, and if not, why".
//
// Written for locked-down corporate machines, where the failure is usually not
// a bug but an absence (no Chrome on the expected path) or a policy (managed
// Chrome refusing remote debugging). Each check prints what it looked for, so
// the output is actionable by someone who cannot install whatever is missing.

import { CdpClient } from "./cdpc/cdp-client.ts";
import { harnessHome, probeChrome } from "./env.ts";
import { closeChrome, launchChrome } from "./launch.ts";

type Status = "ok" | "warn" | "fail";

interface Check {
  name: string;
  status: Status;
  detail: string;
  hint?: string;
}

const ICON: Record<Status, string> = { ok: "✓", warn: "!", fail: "✗" };

async function run(): Promise<Check[]> {
  const checks: Check[] = [];

  checks.push({
    name: "deno",
    status: "ok",
    detail: `${Deno.version.deno} (${Deno.build.target})`,
  });

  const home = harnessHome();
  const hasHarness = await exists(`${home}/harness/audit.ts`);
  checks.push({
    name: "harness home",
    status: hasHarness ? "ok" : "fail",
    detail: home,
    hint: hasHarness
      ? undefined
      : "Set WEB_RESILIENCE_HOME to the repo checkout.",
  });

  const probe = probeChrome();
  const found = probe.candidates.filter((c) => c.exists);
  if (!found.length) {
    checks.push({
      name: "chrome",
      status: "fail",
      detail: `no binary found on ${probe.platform}; searched ${probe.candidates.length} paths`,
      hint: "npx @puppeteer/browsers install chrome@stable, then export WR_CHROME=<path>",
    });
  } else {
    const chosen = probe.chosen!;
    checks.push({
      name: "chrome",
      status: "ok",
      detail: `${chosen.path} (via ${chosen.source})`,
    });
    if (chosen.policyManaged) {
      const unmanaged = found.find((c) => !c.policyManaged);
      checks.push({
        name: "chrome policy exposure",
        status: "warn",
        detail: "selected binary is a managed install; enterprise policy can disable CDP",
        hint: unmanaged
          ? `A policy-free build is available: export WR_CHROME="${unmanaged.path}"`
          : "If the CDP check below fails, install Chrome for Testing: npx @puppeteer/browsers install chrome@stable",
      });
    }
  }

  // The only check that actually proves anything: launch it and speak CDP.
  if (found.length) {
    const tmp = await Deno.makeTempDir({ prefix: "wr-doctor-" });
    try {
      const launched = await launchChrome(`${tmp}/profile`);
      const cdp = new CdpClient(launched.wsUrl);
      await cdp.ready();
      const version = await cdp.send("Browser.getVersion");
      cdp.close();
      await closeChrome(launched.proc);
      checks.push({
        name: "cdp handshake",
        status: "ok",
        detail: String(version.product ?? "connected"),
      });
    } catch (error) {
      checks.push({
        name: "cdp handshake",
        status: "fail",
        detail: String(error).split("\n")[0],
        hint: String(error).includes("RemoteDebuggingAllowed")
          ? "Managed Chrome is blocking CDP — use a Chrome for Testing build."
          : "Full error above; run with WR_CHROME set to try another binary.",
      });
    } finally {
      await Deno.remove(tmp, { recursive: true }).catch(() => {});
    }
  }

  return checks;
}

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

if (import.meta.main) {
  const checks = await run();
  const json = Deno.args.includes("--json");

  if (json) {
    console.log(JSON.stringify({ checks }, null, 2));
  } else {
    console.log("web-resilience doctor\n");
    for (const c of checks) {
      console.log(`${ICON[c.status]} ${c.name}: ${c.detail}`);
      if (c.hint) console.log(`    → ${c.hint}`);
    }
    console.log("");
  }

  const failed = checks.filter((c) => c.status === "fail");
  if (failed.length) {
    if (!json) console.log(`${failed.length} blocking problem(s).`);
    Deno.exit(1);
  }
  if (!json) console.log("Ready to audit.");
  Deno.exit(0);
}
