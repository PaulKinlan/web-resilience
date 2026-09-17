// isolation.ts — the competitive guard.
//
// The autoresearch loop lets a model rewrite part of this repo and keeps
// whatever scores best. That is only meaningful if the model cannot touch the
// thing doing the scoring. Nothing enforced that until now: a mutator could
// have "improved" the score by relaxing a rubric or editing a fixture, and the
// loop would have reported a win.
//
// So every round declares which paths are mutable, and ANY change outside that
// set fails the round. The frozen set always includes eval/ (the rubrics and
// the scorer) and fixtures/ (the ground truth the rubrics describe).

/** What a given objective is allowed to rewrite. */
export interface IsolationPolicy {
  /** Path prefixes the mutator may add to, edit, or delete. */
  mutable: string[];
  /**
   * Prefixes that are frozen no matter what an objective claims. Belt and
   * braces: an objective that mistakenly listed "eval" as mutable would
   * otherwise silently disable the guard.
   */
  alwaysFrozen: string[];
}

export const GROUND_TRUTH: string[] = ["eval/", "fixtures/"];

export function policy(mutable: string[]): IsolationPolicy {
  return { mutable, alwaysFrozen: GROUND_TRUTH };
}

export interface IsolationResult {
  changed: string[];
  violations: string[];
  ok: boolean;
}

/**
 * Parse `git status --porcelain=v1 -z` output into the set of touched paths.
 *
 * NUL-separated rather than line-based because a newline is legal in a
 * filename and would otherwise let a path smuggle itself past the guard.
 * Rename and copy entries carry two paths (`R  <new>\0<old>\0`); both count as
 * touched, since a rename out of a frozen directory is still a change to it.
 */
export function parsePorcelainZ(output: string): string[] {
  const paths: string[] = [];
  // Trailing NUL produces an empty final field.
  const fields = output.split("\0").filter((f) => f.length > 0);

  for (let i = 0; i < fields.length; i++) {
    const entry = fields[i];
    // "XY path" — status is the first two chars, then a single space.
    const status = entry.slice(0, 2);
    const path = entry.slice(3);
    if (!path) continue;
    paths.push(path);
    // A rename/copy is followed by its source path as a separate field.
    if (status[0] === "R" || status[0] === "C") {
      const source = fields[++i];
      if (source) paths.push(source);
    }
  }
  return paths;
}

function underAny(path: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => {
    const p = prefix.endsWith("/") ? prefix : `${prefix}/`;
    return path === prefix.replace(/\/$/, "") || path.startsWith(p);
  });
}

/** Classify a set of changed paths against a policy. */
export function checkPaths(
  changed: string[],
  isolation: IsolationPolicy,
): IsolationResult {
  const violations = changed.filter((path) =>
    underAny(path, isolation.alwaysFrozen) || !underAny(path, isolation.mutable)
  );
  // A path can violate on both counts; dedupe so the message reads cleanly.
  const unique = [...new Set(violations)].sort();
  return { changed, violations: unique, ok: unique.length === 0 };
}

/** Run the guard against a real working tree. */
export async function checkWorktree(
  dir: string,
  isolation: IsolationPolicy,
): Promise<IsolationResult> {
  const status = new Deno.Command("git", {
    args: ["-C", dir, "status", "--porcelain=v1", "-z", "--untracked-files=all"],
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await status.output();
  if (code !== 0) {
    throw new Error(`git status failed in ${dir}: ${new TextDecoder().decode(stderr)}`);
  }
  return checkPaths(parsePorcelainZ(new TextDecoder().decode(stdout)), isolation);
}

export function describeViolations(result: IsolationResult): string {
  return [
    "ISOLATION VIOLATION — the mutator changed frozen paths.",
    "The rubrics and fixtures are the ground truth; a round that edits them",
    "is measuring itself and its score is meaningless.",
    "",
    ...result.violations.map((v) => `  ${v}`),
  ].join("\n");
}
