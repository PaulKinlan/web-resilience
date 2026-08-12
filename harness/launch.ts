// launch.ts — spawn headless Chrome and resolve its CDP WebSocket endpoint.
// Mirrors the web-uplift evidence pattern (raw CDP, no puppeteer dependency).

const CHROME = Deno.env.get("WR_CHROME") ??
  "/usr/bin/chromium";

export interface Launched {
  port: number;
  wsUrl: string;
  proc: Deno.Child;
}

export async function launchChrome(
  userDataDir: string,
  extraArgs: string[] = [],
): Promise<Launched> {
  const proc = new Deno.Command(CHROME, {
    args: [
      "--headless=new",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--remote-debugging-port=0",
      `--user-data-dir=${userDataDir}`,
      "about:blank",
      ...extraArgs,
    ],
    stdout: "piped",
    stderr: "piped",
  }).spawn();

  let port = 0;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 250));
    const reader = proc.stderr.getReader();
    const { value, done } = await reader.read();
    reader.releaseLock();
    const line = done ? null : new TextDecoder().decode(value);
    if (line?.includes("DevTools listening")) {
      port = Number(line.match(/ws:\/\/127\.0\.0\.1:(\d+)/)?.[1] ?? 0);
      break;
    }
  }
  if (!port) throw new Error("chrome did not expose a DevTools port");
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  return { port, wsUrl: version.webSocketDebuggerUrl, proc };
}

export async function closeChrome(proc: Deno.Child) {
  try {
    proc.kill("SIGKILL");
  } catch {
    // already gone
  }
}
