# Guide: Chrome Intervention Budgets (heavy ads, slow-network, partitioning)

**Failure class:** intervention-triggered breakage
**Audit scenarios:** `cpu-6x`, `cpu-20x`, `throttled-2g`, `incognito`
**Symptom the audit catches:** ad/embed frames removed ("Ad removed"), hidden
content never loads, cross-site scripts blocked, storage reads/writes failing.

## Root cause
Chrome interventions protect users with hard budgets: heavy-ad (>4 MB network,
>15 s main-thread in 30 s, >60 s total), slow-network (blocks cross-site
parser-blocking `document.write` scripts on 2G), storage partitioning (third-
party storage scoped by top-level site), notification/autoplay policies. Sites
that don't respect the budgets break under the intervention.

## Canonical pattern
1. **Stay under the ad budgets:** lazy-load ads, cap third-party network,
   no busy-loops in ad frames; verify with the audit's cpu+throttled runs.
2. **Never `document.write` external scripts** — use real `<script src>`,
   `type=module`, or import maps; content must load on 2G.
3. **First-party storage only:** don't assume cross-site cookies/storage;
   wrap storage writes in try/catch (partitioning + quota throw SecurityError/
   QuotaExceededError).
4. **Respect autoplay + notification policies:** muted + play-on-interaction;
   request permissions after engagement with context.
5. **Hidden content:** no hidden heavy iframes; `loading=lazy` for below-fold.

## Re-verify
```bash
deno run -A harness/run-scenario.ts <url> --scenario throttled-2g --screenshot
deno run -A harness/run-scenario.ts <url> --scenario cpu-20x --screenshot
deno run -A harness/run-scenario.ts <url> --scenario incognito
# pass: content loads under throttle/cpu; storage failures are caught; no
# intervention removal in the capture.
```
