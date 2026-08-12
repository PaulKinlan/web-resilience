# Guide: SPA Deep-Link & Refresh Routing

**Failure class:** routing
**Audit scenarios:** baseline navigation to a deep route (interaction step)
**Symptom:** direct refresh or deep-link on a non-root route 404s; share links
break.

## Root cause
No server rewrite to the SPA shell for non-root paths (platform-specific config
bugs included).

## Canonical pattern
1. Server rewrites: nginx `try_files ... /index.html`, connect-history-api-
   fallback, platform rewrites (Vercel/Netlify/Firebase equivalents).
2. A catch-all client route that renders 404-aware content for unknown paths.
3. Test the actual deploy target (rewrites are platform-specific + easy to get
   wrong).

## Re-verify
Interaction step: navigate to a deep route + reload → pass: the shell renders +
the route state restores.
