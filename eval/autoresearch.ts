// autoresearch.ts — goal-setting loop over the SKILLS (not the eval).
// Each iteration: run the eval on the fixtures → record scores → propose an
// improvement to the skill/guides → re-run → keep the winning variant.
// This is the "competitive" loop Paul asked for: the eval rubrics are frozen;
// only the skills/guides mutate.
//
//   deno run -A eval/autoresearch.ts --rounds 3
//
// Wiring note: in the full loop a model proposes the mutation (a skill prompt
// or guide edit) between rounds. This scaffold runs the measurement + records
// the score history; the mutation step plugs into the pi-autoresearch pattern.

import { runEval } from "./run-eval.ts";

interface Round {
  round: number;
  score: number;
  note: string;
  commit?: string;
}

export async function measure(fixtureUrl: string, rubricPath: string): Promise<number> {
  const score = await runEval(fixtureUrl, rubricPath, "/tmp/wr-ar");
  return score;
}

export async function main() {
  const rounds = Number(Deno.args[Deno.args.indexOf("--rounds") + 1] ?? 3);
  const fixtures = [
    { url: "http://127.0.0.1:8765/resilient-club/", rubric: "eval/rubrics/resilient-club.json" },
    { url: "http://127.0.0.1:8765/reference/", rubric: "eval/rubrics/reference.json" },
  ];
  const history: Round[] = [];
  for (let i = 0; i < rounds; i++) {
    let total = 0;
    for (const f of fixtures) {
      const s = await measure(f.url, f.rubric);
      total += s.matched;
      console.log(`round ${i + 1}: ${f.rubric} → ${s.matched}/${s.totalFindings}`);
    }
    history.push({ round: i + 1, score: total, note: "baseline (no skill mutation in scaffold)" });
  }
  console.log("history:", JSON.stringify(history, null, 2));
  // TODO(paulk): between rounds, a model proposes a mutation to the audit
  // skill or a guide; the harness applies it in a worktree, re-measures, and
  // keeps the winner (pi-autoresearch hooks pattern).
  Deno.exit(0);
}

if (import.meta.main) await main();
