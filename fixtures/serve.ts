// Tiny static server for the fixtures (local eval). Production fixtures can be
// deployed to Deno Deploy / Cloudflare Pages — same files.
//
// Two per-fixture behaviours are opt-in via marker files, so a fixture can
// describe its own serving requirements instead of this file accumulating
// special cases:
//
//   <fixture>/.spa            unknown paths fall back to that fixture's
//                             index.html — needed to test SPA deep links.
//   <fixture>/.headers.json   extra response headers for that fixture's HTML.
//                             Content-Security-Policy-Report-Only only works
//                             as a real header; the <meta> form is ignored by
//                             the spec, so the CSP fixture cannot be static.

const root = new URL("./", import.meta.url);
const port = Number(Deno.args[0] ?? 8080);

const mime: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

/** First path segment, e.g. "spa-hydration" from "/spa-hydration/item/42". */
function fixtureOf(pathname: string): string | null {
  const segment = pathname.replace(/^\//, "").split("/")[0];
  return segment || null;
}

async function exists(url: URL): Promise<boolean> {
  try {
    await Deno.stat(url);
    return true;
  } catch {
    return false;
  }
}

const headerCache = new Map<string, Record<string, string>>();

async function extraHeaders(fixture: string | null): Promise<Record<string, string>> {
  if (!fixture) return {};
  const cached = headerCache.get(fixture);
  if (cached) return cached;
  let headers: Record<string, string> = {};
  try {
    headers = JSON.parse(await Deno.readTextFile(new URL(`${fixture}/.headers.json`, root)));
  } catch {
    // No marker file: the common case.
  }
  headerCache.set(fixture, headers);
  return headers;
}

async function serveFile(file: URL, fixture: string | null): Promise<Response | null> {
  try {
    const bytes = await Deno.readFile(file);
    const ext = file.pathname.slice(file.pathname.lastIndexOf("."));
    const type = mime[ext] ?? "application/octet-stream";
    const headers: Record<string, string> = { "content-type": type };
    // Only decorate documents; a CSP header on a stylesheet means nothing.
    if (ext === ".html") Object.assign(headers, await extraHeaders(fixture));
    return new Response(bytes, { headers });
  } catch {
    return null;
  }
}

Deno.serve({ port, hostname: "127.0.0.1" }, async (req) => {
  const url = new URL(req.url);
  const fixture = fixtureOf(url.pathname);

  let rel = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\//, "");
  if (rel.endsWith("/")) rel += "index.html";
  const file = new URL(rel, root);

  // Path traversal guard, unchanged.
  if (file.pathname.startsWith(root.pathname)) {
    const response = await serveFile(file, fixture);
    if (response) return response;

    // SPA fallback, opt-in per fixture. A real SPA host rewrites unknown
    // paths to the shell; without this a deep link 404s and the interesting
    // failure (a shell that renders nothing until JS runs) never gets tested.
    if (fixture && await exists(new URL(`${fixture}/.spa`, root))) {
      const shell = new URL(`${fixture}/index.html`, root);
      const fallback = await serveFile(shell, fixture);
      if (fallback) return fallback;
    }
  }
  return new Response("not found", { status: 404 });
});
