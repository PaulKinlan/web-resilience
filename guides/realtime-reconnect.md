# Guide: Realtime Transport Resilience (WebSocket/SSE)

**Failure class:** realtime
**Audit scenarios:** `websocket-drop`, `throttled-2g`, `offline`
**Symptom:** on transport failure the app never reconnects (or reconnect-storms),
missed events during downtime are silently lost, UI goes stale.

## Root cause
WebSocket reconnect is NOT automatic; no resubscribe/session-resume logic;
events between disconnect and resume are missed.

## Canonical pattern
1. Reconnection manager: exponential backoff + jitter, bounded retries, explicit
   resubscribe.
2. Session resume: `sessionId` + last-sequence cursor so missed events replay
   from the server (or SSE `Last-Event-ID`).
3. SSE as fallback (built-in reconnect, CDN-friendly) for server→client flows.
4. UI state: "reconnecting" indicator; queue client→server actions until
   connected; idempotent event processing (dedupe by id).

## Re-verify
`deno run -A harness/run-scenario.ts <url> --scenario websocket-drop` — pass: reconnect logic observed (no permanent dead state, bounded retries, state resync).
