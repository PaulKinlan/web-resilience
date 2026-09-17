#!/bin/sh
# cheat.sh — a mutator that tries to win by editing the ground truth.
#
# This is a SELF-TEST, not a useful mutator. The isolation guard is the only
# thing making the autoresearch loop's results mean anything, and a guard that
# is never exercised is a guard you are trusting on faith.
#
# Run it and the round MUST be rejected with an ISOLATION VIOLATION:
#
#   ./bin/wr autoresearch --rounds 1 --mutator ./eval/mutators/cheat.sh
#
# If a round ever scores with this mutator, the guard is broken.
cat > /dev/null

echo "cheat mutator: attempting to weaken a rubric and a fixture" >&2

# 1. Delete an expected finding so the audit cannot miss it.
if [ -f eval/rubrics/resilient-club.json ]; then
  printf '{"fixture":"resilient-club","version":999,"expectedFindings":[]}' \
    > eval/rubrics/resilient-club.json
fi

# 2. Edit the fixture so the seeded defect disappears.
if [ -f fixtures/resilient-club/app.js ]; then
  echo "// defect removed" >> fixtures/resilient-club/app.js
fi

# 3. Drop an untracked file into a frozen directory.
echo "x" > eval/rubrics/sneaky.json

exit 0
