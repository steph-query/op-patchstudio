import type { XyPathRecord } from './deviceXyParser';

/**
 * Which projects reference a given sample — the reverse of
 * `inspectProjectDependencies`, which answers the forward question for one project.
 *
 * The forward direction tells you what a project needs. It cannot tell you whether
 * removing a file will break something, because that depends on every *other*
 * project too. Answering it meant opening each project and comparing by eye, which
 * is why the inspector says plainly that its report "does not establish that other
 * files are safe to delete".
 *
 * The rule this module exists to enforce: **an unread project makes every answer
 * provisional.** If one project out of forty could not be parsed, a sample that
 * appears in none of the other thirty-nine is still not known to be unused — the
 * unread one may be the only thing holding it. Reporting "unused" there would be
 * the single most damaging thing this app could get wrong, so `usage()` reports
 * `unreferenced` only when the sweep was complete, and `indeterminate` otherwise.
 */

/** One project as read from the device. `records: null` means it could not be parsed. */
export interface ScannedProject {
  name: string;
  records: XyPathRecord[] | null;
  /** Why it could not be read, when `records` is null. */
  problem?: string;
}

export interface SampleUsageIndex {
  /** Exact path → the projects referencing it, in the order scanned. */
  byPath: Map<string, string[]>;
  /** Projects that were read successfully. */
  scanned: string[];
  /** Projects that could not be read, with the reason. */
  unread: Array<{ name: string; problem: string }>;
}

export type UsageVerdict =
  /** Referenced by at least one project. Naming them is the point. */
  | { state: 'referenced'; projects: string[] }
  /** Every project was read, and none reference it. */
  | { state: 'unreferenced' }
  /** No project references it, but at least one project could not be read. */
  | { state: 'indeterminate'; unread: Array<{ name: string; problem: string }> };

/**
 * Only the two path kinds that name a file on the device can be looked up.
 *
 * `content` is built-in factory material with no file behind it, and `short-ref`
 * names a preset rather than a sample — counting either as a reference to a path
 * would report phantom usage and make a deletable file look pinned.
 */
function namesAFile(record: XyPathRecord): boolean {
  return record.type === 'preset-sample' || record.type === 'standalone-sample';
}

export function buildSampleUsage(projects: ScannedProject[]): SampleUsageIndex {
  const byPath = new Map<string, string[]>();
  const scanned: string[] = [];
  const unread: Array<{ name: string; problem: string }> = [];

  for (const project of projects) {
    if (project.records === null) {
      unread.push({ name: project.name, problem: project.problem ?? 'could not be read' });
      continue;
    }
    scanned.push(project.name);
    // A project referencing the same sample twice is still one project; the
    // question asked is "which projects", not "how many references".
    const seen = new Set<string>();
    for (const record of project.records) {
      if (!namesAFile(record) || seen.has(record.fullPath)) continue;
      seen.add(record.fullPath);
      const users = byPath.get(record.fullPath);
      if (users) users.push(project.name);
      else byPath.set(record.fullPath, [project.name]);
    }
  }
  return { byPath, scanned, unread };
}

/** What is known about one exact path. Never guesses on an incomplete sweep. */
export function usage(index: SampleUsageIndex, path: string): UsageVerdict {
  const projects = index.byPath.get(path);
  if (projects && projects.length) return { state: 'referenced', projects };
  if (index.unread.length) return { state: 'indeterminate', unread: index.unread };
  return { state: 'unreferenced' };
}

/**
 * What is known about one path, *ignoring* one project — the question the inspector
 * actually asks: "does anything other than the project I am looking at use this?"
 *
 * This exists because computing it in the caller gets it wrong in a way that is easy
 * to miss. Filtering the current project out of a `referenced` verdict can leave an
 * empty list, and an empty list reads as "nothing else uses it" — a definite claim.
 * But if a project could not be read, that claim is exactly as unfounded as calling
 * an unreferenced sample unused. Both cases have to collapse to `indeterminate`, so
 * the rule lives here rather than in the rendering.
 */
export function sharingWith(index: SampleUsageIndex, path: string, exclude: string): UsageVerdict {
  const others = (index.byPath.get(path) ?? []).filter(name => name !== exclude);
  if (others.length) return { state: 'referenced', projects: others };
  if (index.unread.length) return { state: 'indeterminate', unread: index.unread };
  return { state: 'unreferenced' };
}

/**
 * Put the verdict in words the user can act on.
 *
 * Deliberately never says "safe to delete". The app does not delete device content,
 * and a sweep of projects cannot see a reference held anywhere else — so the most
 * it can honestly report is that no project on this device names the file.
 */
export function describeUsage(verdict: UsageVerdict, fileName: string): string {
  switch (verdict.state) {
    case 'referenced': {
      const count = verdict.projects.length;
      return `${fileName} is used by ${count} ${count === 1 ? 'project' : 'projects'}: ${verdict.projects.join(', ')}. Removing it would leave ${count === 1 ? 'that project' : 'those projects'} with a missing sample.`;
    }
    case 'unreferenced':
      // "No project references it" is narrower than "nothing uses it", and the gap
      // matters: path inspection is heuristic, so a reference in a form this reader
      // does not recognize looks like no reference at all.
      return `No project on this device references ${fileName}. Every project was read, so that part is complete — but path inspection is partial, a preset may hold its own copy, and copies of these projects elsewhere are not covered. It means no project names it, not that nothing uses it.`;
    case 'indeterminate': {
      const names = verdict.unread.map(item => item.name).join(', ');
      const count = verdict.unread.length;
      return `${fileName} is not referenced by any project that could be read, but ${count} ${count === 1 ? 'project' : 'projects'} could not be checked (${names}). Treat this as unknown rather than unused.`;
    }
  }
}

/**
 * Every scanned path that no project references, ordered.
 *
 * Returns nothing at all when the sweep was incomplete. A partial list here would
 * be read as "these are the unused ones", and the one project that failed to parse
 * is exactly the one likeliest to hold the references nothing else does.
 */
export function unreferencedAmong(index: SampleUsageIndex, candidatePaths: string[]): string[] | null {
  if (index.unread.length) return null;
  return candidatePaths.filter(path => !index.byPath.has(path)).sort((a, b) => a.localeCompare(b));
}
