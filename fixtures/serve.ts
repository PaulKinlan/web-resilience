// Tiny static server for the fixtures (local eval). Production fixtures can be
// deployed to Deno Deploy / Cloudflare Pages — same files.
const root = new URL("./", import.meta.url);
const port = Number(Deno.args[0] ?? 8080);
const mime: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};
Deno.serve({ port, hostname: "127.0.0.1" }, async (req) => {
  const u = new URL(req.url);
  let rel = u.pathname === "/" ? "index.html" : u.pathname.replace(/^\//, "");
  if (rel.endsWith("/")) rel += "index.html";
  const file = new URL(rel, root);
  if (file.pathname.startsWith(root.pathname)) {
    try {
      const bytes = await Deno.readFile(file);
      const ext = file.pathname.slice(file.pathname.lastIndexOf("."));
      return new Response(bytes, { headers: { "content-type": mime[ext] ?? "application/octet-stream" } });
    } catch { /* fallthrough */ }
  }
  return new Response("not found", { status: 404 });
});
