# Guide: Optimistic UI Reconciliation

**Failure class:** user-action lens
**Audit scenarios:** interaction plans under `throttled-2g`/`offline`
**Symptom:** optimistic updates diverge from server truth on failure; retries
duplicate effects; UI shows stale state after rollback.

## Root cause
No pending/confirmed model; no idempotency keys; no version checks; rollback
not reconciled with authoritative state.

## Canonical pattern
1. Explicit pending/confirmed (or queued) state per mutation.
2. Idempotency keys on writes (server dedupes retries).
3. Version checks (ETag/If-Match) before applying server responses.
4. On failure: rollback to server truth + refetch/merge; never leave divergent
   state.

## Re-verify
Interaction plan: double-submit + a failing request under throttle → assert no
duplicate effects + UI converges to server state.
