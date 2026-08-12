# Guide: DNS & Network-Request Failure

**Failure class:** `dns-fallback`, `offline-fallback`
**Audit scenarios:** `dns-fail`, `offline`
**Symptom:** every request fails with `ERR_NAME_NOT_RESOLVED` / `ERR_INTERNET_DISCONNECTED`; no fallback path.

## Root cause
Navigations + fetches assume DNS/network always work. The GFW, captive portals, VPN flakiness, and corporate proxies all produce exactly these errors.

## Canonical pattern
1. SW shell for navigations (guide: offline-fallback) so the first-party core renders even when DNS fails.
2. First-party-critical assets only for the shell; third-party hosts are the common breakpoint (self-host or fallback).
3. `navigator.onLine` + `online`/`offline` events to update UI + retry queues.
4. Retry with exponential backoff + jitter for transient failures; only idempotent requests.
5. Error surfaces for failed requests (retry button, queued state), never silent hangs.

## Re-verify
`deno run -A harness/run-scenario.ts <url> --scenario dns-fail --screenshot` — pass: shell renders + queued/retry state, no browser error page.
