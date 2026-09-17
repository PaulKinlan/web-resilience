#!/bin/sh
# agentapi-auditor.sh — the --agent-cmd side: produce a findings report by
# actually following the skill, so that skill edits change the measurement.
#
#   ./bin/wr autoresearch --objective skill --rounds 3 \
#     --mutator ./eval/mutators/agentapi-mutator.sh \
#     --agent-cmd ./eval/mutators/agentapi-auditor.sh

set -eu

: "${WR_FIXTURE_URL:?not set}"
: "${WR_FINDINGS_OUT:?not set}"
: "${WR_OUT_DIR:?not set}"
WORKTREE="${WR_REPO:-$(pwd)}"
DONE="${WR_OUT_DIR}/.audit-done"
TIMEOUT_SECONDS="${WR_AUDITOR_TIMEOUT:-1800}"

mkdir -p "$WR_OUT_DIR"
rm -f "$DONE" "$WR_FINDINGS_OUT"

PROMPT=$(cat <<PROMPT_END
Audit ${WR_FIXTURE_URL} for resilience.

Follow the instructions in ${WORKTREE}/skills/web-resilience-audit/SKILL.md
EXACTLY, and read them from that path — not from any installed copy. The point
of this run is to measure those specific instructions.

Use the harness in that same checkout: ${WORKTREE}/bin/wr

Write your findings as JSON to ${WR_FINDINGS_OUT} in this shape:

{"findings":[{"scenario":"offline","class":"offline-fallback",
  "severity":"critical","signal":"<quoted evidence>","resource":"<url>",
  "summary":"<one line>"}]}

- "scenario" must be a scenario id from the matrix.
- "class" is the failure class.
- Report a finding only where you have evidence in the report. Inventing
  findings is scored against you as heavily as missing them.

When the file is written, create ${DONE} to signal completion.
PROMPT_END
)

echo "agentapi-auditor: auditing ${WR_FIXTURE_URL}" >&2
agentapi new-conversation --title="autoresearch audit ${WR_FIXTURE_NAME:-fixture}" "$PROMPT" >&2

elapsed=0
while [ ! -f "$DONE" ]; do
  if [ "$elapsed" -ge "$TIMEOUT_SECONDS" ]; then
    echo "agentapi-auditor: timed out after ${TIMEOUT_SECONDS}s" >&2
    exit 1
  fi
  sleep 10
  elapsed=$((elapsed + 10))
done
rm -f "$DONE"

if [ ! -f "$WR_FINDINGS_OUT" ]; then
  echo "agentapi-auditor: agent signalled done but wrote no findings" >&2
  exit 1
fi
echo "agentapi-auditor: findings written" >&2
exit 0
