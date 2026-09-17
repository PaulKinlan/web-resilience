# Mutators and agent runners

The autoresearch loop does not embed a model. It shells out, so you can point
it at whatever you actually have — a local agent CLI, an API script, or a
person.

```bash
./bin/wr serve 8080 &
./bin/wr autoresearch --objective harness --rounds 5 --mutator ./eval/mutators/agentapi-mutator.sh
```

## The two objectives

| | `--objective harness` | `--objective skill` |
|---|---|---|
| Mutable | `harness/` | `skills/`, `guides/` |
| Measured by | scoring `audit.json` vs the rubric | scoring an **agent's findings report** vs the rubric |
| Needs `--agent-cmd` | no | **yes** |

> [!IMPORTANT]
> Use `--objective skill` if you are editing prose. The harness objective
> cannot see skill edits at all: `SKILL.md` and the guides never touch an
> `audit.json`, so every variant scores identically and "keep the winner"
> degenerates into keeping the first one.

## Mutator contract

A mutator is any executable. It runs with:

- **cwd** = an isolated git worktree (never your working tree)
- **stdin** = a JSON context: round number, the brief, mutable and frozen
  paths, the champion's value, and the score history
- **exit 0** = a mutation was proposed; non-zero = skip this round

It edits files in place. It must not commit — the loop does that.

Anything it changes outside the mutable paths **fails the round unscored**.
`eval/` and `fixtures/` are frozen unconditionally: a loop that can edit its
own rubric optimises the ruler, not the tool.

## Agent-runner contract (`--agent-cmd`, skill objective only)

Runs once per fixture, with **cwd** = the worktree and these env vars:

| Variable | Meaning |
|---|---|
| `WR_FIXTURE_URL` | the URL to audit |
| `WR_FIXTURE_NAME` | `resilient-club` or `reference` |
| `WR_FINDINGS_OUT` | **write the findings report here** |
| `WR_OUT_DIR` | scratch space for this fixture |
| `WR_REPO` | the worktree root |

It must read `skills/web-resilience-audit/SKILL.md` **from the worktree** —
that is the whole point; reading the installed copy would measure the same
prose every round.

Findings report shape (a bare array also works, and a ```json fence is
tolerated):

```json
{
  "findings": [
    {
      "scenario": "offline",
      "class": "offline-fallback",
      "severity": "critical",
      "signal": "net::ERR_INTERNET_DISCONNECTED on /app.js",
      "resource": "/app.js",
      "summary": "No service worker; the page is blank offline."
    }
  ]
}
```

Scoring matches on `(scenario, class)` only. The prose is not matched — that
would score phrasing rather than detection.

> [!WARNING]
> Reporting extra classes the rubric does not mention counts as a false
> positive. Without that, the winning strategy is to report every class
> against every scenario. The cost is that a genuinely novel finding also
> scores against you.

## Known limits

- **Measurement noise.** Real browsers, real timing. A one-point delta over a
  single round is not a signal. Candidates must be *strictly* better to
  promote, which stops drift but does not make a small win trustworthy — run
  more rounds, or widen the fixture set.
- **Fixture overfitting.** The guard stops a mutator editing the rubric. It
  cannot stop the harness objective special-casing a fixture's markup, which
  raises the score without improving detection. Hold out a fixture if this
  matters to you.
- **Two fixtures is a small world.** The score has a ceiling of 10; there is
  not much headroom to optimise into.
