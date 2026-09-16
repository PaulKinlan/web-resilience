// env.ts — locate the things the harness needs (Chrome, the repo root) without
// assuming a Linux workstation or a particular install method.
//
// Resolution order for Chrome is deliberate:
//   1. WR_CHROME      — explicit override, always wins
//   2. CHROME_PATH    — the de-facto standard var (puppeteer, lighthouse, CI)
//   3. Chrome for Testing in the puppeteer cache — preferred over a managed
//      Chrome because enterprise policy (RemoteDebuggingAllowed=false) attaches
//      to the branded browser's bundle id, not to CfT. On a corp machine this
//      is often the ONLY binary that will expose a CDP port.
//   4. Platform install locations for branded Chrome/Chromium/Edge
//
// Nothing here throws until you actually ask for a path — `probeChrome()`
// returns the full picture so `wr doctor` can explain what is missing.

export type Platform = "darwin" | "linux" | "windows";

export interface ChromeCandidate {
  path: string;
  source: "WR_CHROME" | "CHROME_PATH" | "chrome-for-testing" | "installed";
  exists: boolean;
  /** Chrome for Testing / headless-shell builds are not enterprise-policy managed. */
  policyManaged: boolean;
}

export interface ChromeProbe {
  platform: Platform;
  candidates: ChromeCandidate[];
  chosen: ChromeCandidate | null;
}

export function platform(): Platform {
  const os = Deno.build.os;
  if (os === "darwin") return "darwin";
  if (os === "windows") return "windows";
  return "linux";
}

function exists(path: string): boolean {
  try {
    const st = Deno.statSync(path);
    return st.isFile || st.isSymlink;
  } catch {
    return false;
  }
}

function homeDir(): string {
  return Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE") ?? "";
}

/**
 * Chrome for Testing builds cached by puppeteer, newest version first.
 *
 * Layout: ~/.cache/puppeteer/chrome/<platform>-<version>/<binary>
 * Versions sort numerically per component so 148.x beats 99.x.
 */
export function chromeForTestingCandidates(): string[] {
  const roots = [
    Deno.env.get("PUPPETEER_CACHE_DIR"),
    `${homeDir()}/.cache/puppeteer`,
    `${homeDir()}/Library/Caches/puppeteer`,
  ].filter((r): r is string => Boolean(r));

  const found: Array<{ version: number[]; path: string }> = [];
  for (const root of roots) {
    for (const flavour of ["chrome", "chrome-headless-shell"]) {
      let entries: Deno.DirEntry[];
      try {
        entries = [...Deno.readDirSync(`${root}/${flavour}`)];
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isDirectory) continue;
        // e.g. "mac_arm-148.0.7778.97" → [148, 0, 7778, 97]
        const version = (entry.name.split("-").pop() ?? "")
          .split(".")
          .map((n) => Number(n))
          .filter((n) => Number.isFinite(n));
        if (!version.length) continue;
        const dir = `${root}/${flavour}/${entry.name}`;
        for (const rel of binaryNamesFor(flavour)) {
          const path = `${dir}/${rel}`;
          if (exists(path)) found.push({ version, path });
        }
      }
    }
  }

  found.sort((a, b) => {
    for (let i = 0; i < Math.max(a.version.length, b.version.length); i++) {
      const diff = (b.version[i] ?? 0) - (a.version[i] ?? 0);
      if (diff) return diff;
    }
    return 0;
  });
  return found.map((f) => f.path);
}

function binaryNamesFor(flavour: string): string[] {
  const p = platform();
  if (flavour === "chrome-headless-shell") {
    const exe = p === "windows"
      ? "chrome-headless-shell.exe"
      : "chrome-headless-shell";
    const dir = p === "darwin"
      ? "chrome-headless-shell-mac-arm64"
      : p === "windows"
      ? "chrome-headless-shell-win64"
      : "chrome-headless-shell-linux64";
    return [`${dir}/${exe}`, `chrome-headless-shell-mac-x64/${exe}`, exe];
  }
  if (p === "darwin") {
    const app =
      "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
    return [`chrome-mac-arm64/${app}`, `chrome-mac-x64/${app}`];
  }
  if (p === "windows") {
    return ["chrome-win64/chrome.exe", "chrome-win32/chrome.exe"];
  }
  return ["chrome-linux64/chrome", "chrome-linux/chrome"];
}

function installedCandidates(): string[] {
  switch (platform()) {
    case "darwin":
      return [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        `${homeDir()}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
      ];
    case "windows":
      return [
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
        `${homeDir()}\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe`,
      ];
    default:
      return [
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
        "/snap/bin/chromium",
        "/opt/google/chrome/chrome",
      ];
  }
}

function isUnmanagedBuild(path: string): boolean {
  return path.includes("for Testing") || path.includes("chrome-headless-shell");
}

/** Everything we know about Chrome availability — the input to `wr doctor`. */
export function probeChrome(): ChromeProbe {
  const candidates: ChromeCandidate[] = [];

  for (
    const [envVar, source] of [
      ["WR_CHROME", "WR_CHROME"],
      ["CHROME_PATH", "CHROME_PATH"],
    ] as const
  ) {
    const value = Deno.env.get(envVar);
    if (value) {
      candidates.push({
        path: value,
        source,
        exists: exists(value),
        policyManaged: !isUnmanagedBuild(value),
      });
    }
  }

  for (const path of chromeForTestingCandidates()) {
    candidates.push({
      path,
      source: "chrome-for-testing",
      exists: true,
      policyManaged: false,
    });
  }

  for (const path of installedCandidates()) {
    candidates.push({
      path,
      source: "installed",
      exists: exists(path),
      policyManaged: true,
    });
  }

  return {
    platform: platform(),
    candidates,
    chosen: candidates.find((c) => c.exists) ?? null,
  };
}

/** The Chrome binary to launch. Throws with an actionable message if absent. */
export function resolveChrome(): string {
  const probe = probeChrome();
  if (probe.chosen) return probe.chosen.path;
  throw new Error(
    [
      "No Chrome binary found.",
      "",
      "Set one explicitly:",
      "  export WR_CHROME=/path/to/chrome",
      "",
      "Or install a policy-free Chrome for Testing build:",
      "  npx @puppeteer/browsers install chrome@stable",
      "",
      "Run `bin/wr doctor` for the full search path.",
    ].join("\n"),
  );
}

/**
 * Repo root. WEB_RESILIENCE_HOME lets an installed plugin point at wherever the
 * checkout lives; otherwise we walk up from this module (harness/env.ts).
 */
export function harnessHome(): string {
  const configured = Deno.env.get("WEB_RESILIENCE_HOME");
  if (configured) return configured.replace(/\/+$/, "");
  return decodeURIComponent(new URL("..", import.meta.url).pathname).replace(
    /\/+$/,
    "",
  );
}
