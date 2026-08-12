# Guide: Session & Auth Expiry Recovery

**Failure class:** session (user-action lens)
**Audit scenarios:** interaction plans (fixture with short-lived session) + `offline`
**Symptom:** token expiry mid-flow drops in-progress work; re-auth loses state;
refresh-loop storms.

## Root cause
Auth failures treated as fatal; no draft persistence; refresh loops without
guards.

## Canonical pattern
1. Intercept 401/expiry → re-auth (silent refresh or prompt) → retry the
   original request.
2. Preserve in-progress work (drafts) — persist on `visibilitychange`, restore
   after re-auth.
3. Guard refresh loops (short-lived recovery guards, activity-based refresh).
4. Activity-based session semantics (don't drop active users as idle).

## Re-verify
Interaction plan: fill a form → expire the session → submit → assert the request
retries after re-auth and the draft survives.
