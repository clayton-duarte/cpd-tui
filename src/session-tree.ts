import type { PiSession } from './sessions.ts';

export interface SessionTreeEntry {
  session: PiSession;
  depth: number;
}

/**
 * Order sessions as a tree using the native `parentPath` (pi's cross-session
 * `parentSession` header field). Roots render first (preserving the input's
 * newest-first order), each followed immediately by its children, newest
 * first, indented one level deeper.
 *
 * Robustness:
 *  - parentPath null, or pointing at a file not in this list => root.
 *  - A->B->A cycles terminate (visited guard) and every session still
 *    appears exactly once (unvisited cycle members are emitted as roots).
 */
export function orderSessionsAsTree(sessions: readonly PiSession[]): SessionTreeEntry[] {
  const byPath = new Map<string, PiSession>();
  for (const s of sessions) {
    if (s.file) byPath.set(s.file, s);
  }

  const isRoot = (s: PiSession): boolean => {
    const parent = s.parentPath;
    return !parent || !byPath.has(parent);
  };

  // childrenOf preserves the input array's order (already newest-updated
  // first), so children end up newest-first without re-sorting.
  const childrenOf = new Map<string, PiSession[]>();
  for (const s of sessions) {
    if (!s.parentPath || !byPath.has(s.parentPath)) continue;
    const list = childrenOf.get(s.parentPath);
    if (list) list.push(s);
    else childrenOf.set(s.parentPath, [s]);
  }

  const visited = new Set<string>();
  const result: SessionTreeEntry[] = [];

  const visit = (s: PiSession, depth: number): void => {
    const key = s.file || s.id;
    if (visited.has(key)) return;
    visited.add(key);
    result.push({ session: s, depth });
    const children = childrenOf.get(s.file) ?? [];
    for (const child of children) {
      visit(child, depth + 1);
    }
  };

  for (const s of sessions) {
    if (isRoot(s)) visit(s, 0);
  }

  // Any session left unvisited is part of a cycle (every parent resolved,
  // but none of them was ever a root). Break the cycle by emitting it as a
  // root so it still appears exactly once.
  for (const s of sessions) {
    visit(s, 0);
  }

  return result;
}
