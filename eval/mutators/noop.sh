#!/bin/sh
# noop.sh — changes nothing.
#
# Use this to check the loop's plumbing (worktree creation, baseline
# measurement, teardown) without spending a model call. Every round should
# report "mutator changed nothing" and the champion should never move.
cat > /dev/null   # drain the context on stdin
echo "noop mutator: proposing no change" >&2
exit 0
