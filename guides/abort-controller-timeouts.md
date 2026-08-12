# Guide: AbortController / AbortSignal (cancellation + timeouts)

**Failure class:** hang/stale-request; applies to fetch, images, WebSockets,
and any async work
**Audit scenarios:** `throttled-2g`, `throttled-slow`, `offline`, `dns-fail`
**Symptom the audit catches:** requests hang indefinitely under throttling (the
page never times out a stalled fetch); stale responses from superseded requests
overwrite newer state (search-as-you-type, paging); unhandled `AbortError`
rejections appear in consoleErrors.

## Root cause
The research: `AbortController` + `AbortSignal` exist for a reason — fetch,
image loading, and other async APIs accept a signal. Apps that DON'T use them
leave requests running forever on slow/blocked networks (consuming resources,
freezing UX), let out-of-order responses clobber fresh state, and crash on
user cancellation.

## Canonical pattern
1. **Timeout every network call:** `fetch(url, { signal: AbortSignal.timeout(10_000) })`
   — abort a stalled request instead of hanging. Combine with manual cancel:
   `AbortSignal.any([timeout, controller.signal])`.
2. **Cancel superseded requests:** search-as-you-type, paging, route changes —
   abort the previous request when a new one starts.
3. **Cancel on unmount/hide:** abort in-flight work on component unmount or
   `visibilitychange` hidden.
4. **Treat `AbortError` as control flow:** it is NOT a real fault — don't log it
   as an error; distinguish it from network failures in the catch.
5. **Same pattern for WebSockets/images/event sources** where signals apply.

## Re-verify
```bash
deno run -A harness/run-scenario.ts <url> --scenario throttled-2g
# pass: fetches fail/abort within a bounded time (no infinite hang in the
# duration), and AbortError is handled (not in consoleErrors as an error).
```
