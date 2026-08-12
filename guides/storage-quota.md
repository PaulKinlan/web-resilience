# Guide: Storage Quota & Persistence Failure

**Failure class:** `storage-quota`
**Audit scenarios:** `storage-quota`, `storage-low`, `storage-cleared`, `incognito`
**Symptom:** IndexedDB/localStorage writes throw (QuotaExceededError,
SecurityError) and the app breaks; cleared storage leaves the app broken.

## Root cause
Persistence assumed to always work: no quota handling, no error handling on
writes, no rebuild-from-scratch path.

## Canonical pattern
1. Wrap storage writes in try/catch; handle QuotaExceededError + SecurityError
   (partitioned/incognito) explicitly.
2. Quota-aware: check `navigator.storage.estimate()`; degrade to in-memory +
   warn when full.
3. Migrate critical data early + incrementally; keep the payload small.
4. Rebuild from scratch when storage is cleared (no stale-state assumptions).

## Re-verify
`deno run -A harness/run-scenario.ts <url> --scenario storage-quota` + `storage-low` + `storage-cleared` — pass: no uncaught storage errors; app works degraded.
