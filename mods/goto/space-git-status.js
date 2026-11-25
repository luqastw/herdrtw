// Git facts for every space's folder, one shell call per machine:
// repo (its common .git folder), whether the folder is a linked worktree,
// branch, ahead/behind its upstream and how many files are changed.

import { exec } from "herdr";

// Prints one tab-separated line per folder: folder, toplevel, common dir, head, ab, changes.
const READ_GIT = `
for d in "$@"; do
  top=$(git -C "$d" rev-parse --path-format=absolute --show-toplevel 2>/dev/null) || { printf '%s\\t\\t\\t\\t\\t\\n' "$d"; continue; }
  common=$(git -C "$d" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
  st=$(git -C "$d" status --porcelain=v2 --branch 2>/dev/null)
  head=$(printf '%s\\n' "$st" | sed -n 's/^# branch.head //p')
  ab=$(printf '%s\\n' "$st" | sed -n 's/^# branch.ab //p')
  n=$(printf '%s\\n' "$st" | grep -v '^#' | grep -c .)
  printf '%s\\t%s\\t%s\\t%s\\t%s\\t%s\\n' "$d" "$top" "$common" "$head" "$ab" "$n"
done
`;

// Kept across popup openings (module code is shared by copies), so the list shows
// last time's git facts at once and refreshes them in the background.
const cache = new Map(); // "<machine>|<folder>" -> facts, null: not a repo

export const cacheKey = (machine, folder) => `${machine ?? ""}|${folder}`;

export function cachedGit(machine, folder) {
  return cache.get(cacheKey(machine, folder));
}

function parseLine(line) {
  const [folder, top, common, head, ab, changes] = line.split("\t");
  if (!top) return [folder, null];
  const repoRoot = common.endsWith("/.git") ? common.slice(0, -5) : common.replace(/\.git$/, "");
  const m = /\+(\d+) -(\d+)/.exec(ab ?? "");
  return [folder, {
    top,
    common,
    repo: repoRoot.split("/").filter(Boolean).pop() ?? top,
    worktree: top !== repoRoot,
    branch: head && head !== "(detached)" ? head : null,
    upstream: Boolean(m),
    ahead: m ? Number(m[1]) : 0,
    behind: m ? Number(m[2]) : 0,
    changes: Number(changes) || 0,
  }];
}

// folders: [{ machine, folder }]. Resolves once every machine answered (or failed).
export async function refreshGit(folders) {
  const byMachine = new Map();
  for (const { machine, folder } of folders) {
    if (!folder) continue;
    const list = byMachine.get(machine ?? null) ?? [];
    if (!list.includes(folder)) list.push(folder);
    byMachine.set(machine ?? null, list);
  }
  await Promise.all([...byMachine].map(async ([machine, list]) => {
    try {
      const r = await exec("sh", ["-c", READ_GIT, "goto", ...list], { on: machine ?? undefined, timeout: 10000 });
      for (const line of r.stdout.split("\n").filter(Boolean)) {
        const [folder, facts] = parseLine(line);
        cache.set(cacheKey(machine, folder), facts);
      }
    } catch {
      // A machine away keeps its last known facts.
    }
  }));
}
