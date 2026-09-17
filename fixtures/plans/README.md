# Interaction plans

A plan is a flow the harness drives **inside every scenario**. Loading a page
tests a fraction of a site's resilience; the failures that matter show up when
someone actually uses it.

`--plan <file>` accepts either format below — the harness sniffs which one it
is, so a recorder export needs no conversion.

## Native format

[`resilient-club.plan.json`](./resilient-club.plan.json)

```json
{ "name": "join-the-club", "steps": [ { "kind": "click", "selector": "#join" } ] }
```

| Field | Meaning |
|---|---|
| `kind` | `click`, `type`, `submit`, `navigate`, `wait`, `wait-for`, `press`, `scroll`, `hover`, `assert-text` |
| `selector` | CSS, or `text=Join`, or `aria/Join the club` |
| `text` | expected substring for `assert-text` |
| `value` | text to type |
| `key` | key name for `press` |
| `ms` | duration for `wait`, timeout for `wait-for` |
| `optional` | record the failure but keep going |
| `label` | what shows up in the report |

## DevTools Recorder export

[`resilient-club.recorder.json`](./resilient-club.recorder.json)

Record a flow in DevTools → **Recorder** → export as JSON, and pass it straight
to `--plan`. On import:

- `setViewport`, `close` and `waitForExpression` are **dropped** — scenarios own
  emulation, and the others have no meaning mid-scenario.
- `keyUp` is dropped so a keypress is not replayed twice.
- The ranked `selectors` array is honoured, but `xpath/` is taken last: it is
  the most brittle under exactly the DOM changes a failure scenario provokes.

## Auto-derivation

No plan and no recording? `--derive-plan` surveys the DOM on a **clean** load
and synthesises a flow. Surveying under an injected failure would describe an
already-broken page and produce a plan that tests nothing.

It is a floor, not a substitute: it finds the primary button and the first
form, not your checkout.

## Reading the result

Each step is run **one at a time**, so the report says which step broke, not
just that the flow did — plus the network and console damage attributed to that
step:

```
[offline]  nav=true failures=3 consoleErrors=0 crash=false flow=1/2 BROKE@1
```

> [!TIP]
> Bookend a flow with `assert-text`. A click that silently does nothing is the
> single most common failure under a blocked-JS or offline scenario, and
> without an assertion it records as a pass.
