// launch.ts — spawn headless Chrome and resolve its CDP WebSocket endpoint.
// Mirrors the web-uplift evidence pattern (raw CDP, no puppeteer dependency).
//
// The endpoint is read from the DevToolsActivePort file Chrome writes into the
// user-data-dir, NOT by scraping stderr. Scraping raced the browser (one chunk
// per poll, so the line could be missed) and left stderr undrained, which can
// wedge Chrome once the pipe buffer fills. The file is also the only reliable
// source when Chrome is started with --remote-debugging-port=0.

import { resolveChrome } from "./env.ts";

export interface Launched {
  port: number;
  wsUrl: string;
  proc: Deno.ChildProcess;
  /** The binary we actually launched — worth recording in the audit report. */
  binary: string;
}

const STARTUP_TIMEOUT_MS = 30_000;

export async function launchChrome(
  userDataDir: string,
  extraArgs: string[] = [],
): Promise<Launched> {
  const binary = resolveChrome();
  await Deno.mkdir(userDataDir, { recursive: true });

  // A stale port file from a previous run would be read as if it were ours.
  const portFile = `${userDataDir}/DevToolsActivePort`;
  await Deno.remove(portFile).catch(() => {});

  const proc = new Deno.Command(binary, {
    args: [
      "--headless=new",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--remote-debugging-port=0",
      `--user-data-dir=${userDataDir}`,
      "about:blank",
      ...extraArgs,
    ],
    stdout: "piped",
    stderr: "piped",
  }).spawn();

  // Drain both pipes continuously; keep a tail for diagnostics. An undrained
  // pipe is a deadlock waiting to happen.
  const diagnostics = drain(proc);

  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const endpoint = await readPortFile(portFile);
    if (endpoint) {
      return { ...endpoint, proc, binary };
    }
    if (await hasExited(proc)) break;
    await new Promise((r) => setTimeout(r, 100));
  }

  await closeChrome(proc);
  throw new Error(launchFailureMessage(binary, diagnostics.tail()));
}

/** Read DevToolsActivePort: line 1 is the port, line 2 the browser ws path. */
async function readPortFile(
  portFile: string,
): Promise<{ port: number; wsUrl: string } | null> {
  let contents: string;
  try {
    contents = await Deno.readTextFile(portFile);
  } catch {
    return null;
  }
  const [portLine, wsPath] = contents.split("\n");
  const port = Number(portLine?.trim());
  if (!Number.isFinite(port) || port <= 0) return null;
  // Chrome writes the port before the ws path; wait for both.
  if (!wsPath?.startsWith("/")) return null;
  return { port, wsUrl: `ws://127.0.0.1:${port}${wsPath.trim()}` };
}

interface Diagnostics {
  tail(): string;
}

function drain(proc: Deno.ChildProcess): Diagnostics {
  const chunks: string[] = [];
  const keep = 40; // lines of context is plenty to explain a failed launch

  const pump = async (stream: ReadableStream<Uint8Array>) => {
    const decoder = new TextDecoder();
    for await (const chunk of stream) {
      chunks.push(decoder.decode(chunk, { stream: true }));
      if (chunks.length > keep * 4) chunks.splice(0, chunks.length - keep * 4);
    }
  };
  pump(proc.stderr).catch(() => {});
  pump(proc.stdout).catch(() => {});

  return {
    tail: () => chunks.join("").split("\n").slice(-keep).join("\n").trim(),
  };
}

async function hasExited(proc: Deno.ChildProcess): Promise<boolean> {
  return await Promise.race([
    proc.status.then(() => true),
    new Promise<boolean>((r) => setTimeout(() => r(false), 0)),
  ]);
}

function launchFailureMessage(binary: string, stderrTail: string): string {
  const lines = [
    `Chrome did not expose a DevTools port within ${STARTUP_TIMEOUT_MS / 1000}s.`,
    `  binary: ${binary}`,
  ];
  if (stderrTail) lines.push("", "Chrome output:", indent(stderrTail));
  if (/remote debugging|not allowed|policy/i.test(stderrTail)) {
    lines.push(
      "",
      "This looks like the RemoteDebuggingAllowed enterprise policy blocking CDP.",
      "Managed Chrome cannot be driven; use a Chrome for Testing build instead:",
      "  npx @puppeteer/browsers install chrome@stable",
      "  export WR_CHROME=<path printed by the installer>",
    );
  }
  lines.push("", "Run `bin/wr doctor` to see every candidate binary.");
  return lines.join("\n");
}

function indent(text: string): string {
  return text.split("\n").map((l) => `  ${l}`).join("\n");
}

export async function closeChrome(proc: Deno.ChildProcess) {
  try {
    proc.kill("SIGTERM");
  } catch {
    return; // already gone
  }
  // Give Chrome a moment to flush profile state, then insist.
  const exited = await Promise.race([
    proc.status.then(() => true),
    new Promise<boolean>((r) => setTimeout(() => r(false), 2000)),
  ]);
  if (!exited) {
    try {
      proc.kill("SIGKILL");
      await proc.status;
    } catch {
      // already gone
    }
  }
}
