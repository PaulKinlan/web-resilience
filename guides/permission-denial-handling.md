# Guide: Permission Denial Handling

**Failure class:** permissions (camera/mic/screen/clipboard/sensors/wake-lock/
local-fonts/window-management/idle/geolocation)
**Audit scenarios:** `camera-denied`, `mic-denied`, `screen-capture-denied`,
`clipboard-denied`, `sensors-denied`, `wake-lock-denied`, `local-fonts-denied`,
`window-management-denied`, `idle-detection-denied`, `geolocation-denied`,
`permissions-denied`
**Symptom the audit catches:** under a denied scenario the page's feature
throws/hangs instead of degrading; the permissions-state capture shows the page
never queried `navigator.permissions` (state still `prompt`/`denied` with no
handling).

## Root cause
Sites request permissions without checking state first, then treat the
`getUserMedia`/`querySelector`/etc. promise rejection (or denial) as fatal —
or worse, they never handle the rejection at all (unhandled promise → silent
breakage). The research shows the failure modes: `NotAllowedError` (denied),
`NotFoundError` (no device), `NotReadableError` (device busy),
`OverconstrainedError` (constraints unmet) — plus non-secure contexts where the
API doesn't exist at all.

## Canonical pattern
1. **Pre-check:** `navigator.permissions.query({ name })` BEFORE requesting —
   if `denied`, show the feature disabled with a reason; if `prompt`, request
   after a user action with context (the pre-prompt pattern); observe
   `PermissionStatus.onchange` to re-enable when granted.
2. **Handle every rejection:** `catch` the permission promise and map the error
   name to a UX state (denied/no-device/busy/overconstrained) — never an
   unhandled rejection.
3. **Degrade, don't break:** the feature's absence must not break the page —
   the rest of the app works; the feature shows a fallback UI (e.g. "camera
   unavailable — use the upload option").
4. **Feature-detect first:** `navigator.mediaDevices` may not exist (insecure
   context, older browser) — check before calling.
5. WebRTC-specific: watch `icecandidateerror` + `iceConnectionState` (failed/
   disconnected) and offer TURN/fallback paths; don't assume STUN works on
   restricted networks.

## Before / after
- `fixtures/resilient-club` — no permission handling (features would throw).
- `fixtures/reference` — to add: pre-check + catch + degrade UI.

## Re-verify
```bash
deno run -A harness/run-scenario.ts <url> --scenario camera-denied --screenshot
# pass: the page shows a degraded-but-working state; no unhandled rejection in
# consoleErrors; permissions state reflects the denial handling.
```
