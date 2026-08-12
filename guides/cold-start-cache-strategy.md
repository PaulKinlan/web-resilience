# Guide: Cold Start & Cache Strategy

**Failure class:** `cold-start`
**Audit scenarios:** `no-cache`, `offline`
**Symptom:** every visit pays full first-load cost; no caching strategy; the
page re-downloads everything.

## Root cause
No cache headers/SW cache; unversioned assets (can't long-cache); no shell
precache.

## Canonical pattern
1. Cache headers: `Cache-Control: immutable` + far-future for hashed static;
   `no-cache`/`ETag` for dynamic.
2. SW runtime cache: cache-first for hashed static, stale-while-revalidate for
   dynamic, network-first for navigations.
3. Versioned/hashed URLs so updates don't need cache busting.
4. Precache the shell (guide: offline-fallback).

## Re-verify
`deno run -A harness/run-scenario.ts <url> --scenario no-cache` — pass: the true first-load cost is bounded; `offline` reuses the cache.
