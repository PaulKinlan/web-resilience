#!/bin/sh
# agentapi-mutator.sh — propose a mutation using a local Antigravity agent.
#
# Needs no API key: it drives the agent harness the user is already signed in
# to. Works the same on a managed corporate machine.
#
# agentapi starts a conversation and returns immediately, so this waits on a
# sentinel file rather than on the process. That is deliberate — polling the
# conversation state would couple us to an output schema we do not control.

set -eu

CONTEXT=$(cat)                       # the round context, JSON on stdin
WORKTREE=$(pwd)
DONE="${WORKTREE}/.autoresearch-done"
TIMEOUT_SECONDS="${WR_MUTATOR_TIMEOUT:-900}"

rm -f "$DONE"

PROMPT=$(cat <<PROMPT_END
You are proposing ONE improvement in an automated experiment. Work only in
this checkout: ${WORKTREE}

${CONTEXT}

Rules:
- Edit ONLY the paths listed in mutablePaths above.
- Do NOT touch eval/ or fixtures/. They are frozen ground truth. A round that
  changes them is discarded without being scored, so doing so wastes the round.
- Do NOT commit. The experiment harness commits for you.
- Make ONE focused, substantive change with a clear hypothesis for why it
  should raise the score. A large scattershot diff cannot be attributed.

Think about what the score history above suggests is weak, make the change,
then write a one-paragraph rationale to ${WORKTREE}/.autoresearch-rationale
and finally create the file ${DONE} to signal you are finished.
PROMPT_END
)

echo "agentapi-mutator: starting conversation" >&2
agentapi new-conversation --title="autoresearch mutation" "$PROMPT" >&2

# Wait for the sentinel.
elapsed=0
while [ ! -f "$DONE" ]; do
  if [ "$elapsed" -ge "$TIMEOUT_SECONDS" ]; then
    echo "agentapi-mutator: timed out after ${TIMEOUT_SECONDS}s" >&2
    exit 1
  fi
  sleep 5
  elapsed=$((elapsed + 5))
done

rm -f "$DONE"
[ -f "${WORKTREE}/.autoresearch-rationale" ] && cat "${WORKTREE}/.autoresearch-rationale" >&2
# The sentinel and rationale are scratch; leaving them would read as a mutation
# in an untracked path and fail the isolation guard.
rm -f "${WORKTREE}/.autoresearch-rationale"

echo "agentapi-mutator: done" >&2
exit 0
