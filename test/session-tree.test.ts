import { describe, it, expect, afterEach } from 'vitest';
import { rmSync } from 'node:fs';
import { listSessions } from '../src/sessions.ts';
import { orderSessionsAsTree } from '../src/session-tree.ts';
import { renderSwitcher } from '../src/switcher-render.ts';
import { makeFixtureRoot, writeSessionFixture } from './fixtures.ts';

const roots: string[] = [];
function root(): string {
  const r = makeFixtureRoot();
  roots.push(r);
  return r;
}

afterEach(() => {
  while (roots.length) {
    const r = roots.pop()!;
    rmSync(r, { recursive: true, force: true });
  }
});

describe('session tree — native parentSession lineage', () => {
  it('[A] parent + child: child renders indented directly under its parent, not at top level', async () => {
    const r = root();
    const parentFile = writeSessionFixture({ root: r, cwd: '/x/parent', id: 'parent', createdIso: '2026-01-01T00:00:00.000Z' });
    writeSessionFixture({ root: r, cwd: '/x/child', id: 'child', createdIso: '2026-01-02T00:00:00.000Z', parentSession: parentFile });

    const sessions = await listSessions(r);
    const tree = orderSessionsAsTree(sessions);

    expect(tree.map((e) => e.session.id)).toEqual(['parent', 'child']);
    const parentEntry = tree.find((e) => e.session.id === 'parent')!;
    const childEntry = tree.find((e) => e.session.id === 'child')!;
    expect(parentEntry.depth).toBe(0);
    expect(childEntry.depth).toBe(1);

    // The child must appear immediately after its parent in render order, not
    // at the top level alongside it.
    const parentIdx = tree.findIndex((e) => e.session.id === 'parent');
    const childIdx = tree.findIndex((e) => e.session.id === 'child');
    expect(childIdx).toBe(parentIdx + 1);
  });

  it('[B] parentSession pointing at a MISSING file is rendered as a root, no throw', async () => {
    const r = root();
    writeSessionFixture({
      root: r,
      cwd: '/x/orphan',
      id: 'orphan',
      parentSession: '/does/not/exist/2026-01-01T00-00-00.000Z_ghost.jsonl',
    });

    // A plain root sibling is required: without one, the cycle-breaker's
    // final pass would emit the orphan at depth 0 anyway, so this test would
    // still pass even if the missing-parent check were deleted. With a
    // sibling, a regression demotes the orphan BELOW it and is caught.
    writeSessionFixture({ root: r, cwd: '/x/plain', id: 'plain' });

    const sessions = await listSessions(r);
    expect(() => orderSessionsAsTree(sessions)).not.toThrow();
    const tree = orderSessionsAsTree(sessions);
    expect(tree).toHaveLength(2);

    const orphanEntry = tree.find((e) => e.session.id === 'orphan');
    expect(orphanEntry?.depth).toBe(0);

    // The orphan must be treated as a root in the FIRST pass, keeping its
    // input position, not swept up by the trailing cycle-breaker pass.
    expect(tree.map((e) => e.session.id)).toEqual(
      sessions.map((s) => s.id),
    );
  });

  it('[C] cycle A->B->A terminates and every session appears EXACTLY once', () => {
    // Hand-edited headers only pi's writer would never produce: A's parent is
    // B, and B's parent is A. Construct PiSession objects directly (no need
    // to round-trip through disk fixtures for this).
    const sessionA = {
      id: 'a',
      file: '/sessions/a.jsonl',
      cwd: '/x/a',
      label: 'a',
      created: new Date('2026-01-01T00:00:00.000Z'),
      updated: new Date('2026-01-01T00:00:00.000Z'),
      parentPath: '/sessions/b.jsonl',
    };
    const sessionB = {
      id: 'b',
      file: '/sessions/b.jsonl',
      cwd: '/x/b',
      label: 'b',
      created: new Date('2026-01-02T00:00:00.000Z'),
      updated: new Date('2026-01-02T00:00:00.000Z'),
      parentPath: '/sessions/a.jsonl',
    };

    let result: ReturnType<typeof orderSessionsAsTree> | undefined;
    expect(() => {
      result = orderSessionsAsTree([sessionA, sessionB]);
    }).not.toThrow();

    expect(result).toBeDefined();
    expect(result!).toHaveLength(2);
    const ids = result!.map((e) => e.session.id).sort();
    expect(ids).toEqual(['a', 'b']);
  });

  it('[D] no session has parentSession: flat list, unchanged from current output', async () => {
    const r = root();
    writeSessionFixture({ root: r, cwd: '/x/one', id: 'one', createdIso: '2026-01-02T00:00:00.000Z' });
    writeSessionFixture({ root: r, cwd: '/x/two', id: 'two', createdIso: '2026-01-01T00:00:00.000Z' });

    const sessions = await listSessions(r);
    const tree = orderSessionsAsTree(sessions);

    expect(tree.map((e) => e.session.id)).toEqual(sessions.map((s) => s.id));
    expect(tree.every((e) => e.depth === 0)).toBe(true);
  });

  it('[E] ascii mode: indent/branch characters are pure ASCII', async () => {
    const r = root();
    const parentFile = writeSessionFixture({ root: r, cwd: '/x/parent', id: 'parent', createdIso: '2026-01-01T00:00:00.000Z' });
    writeSessionFixture({ root: r, cwd: '/x/child', id: 'child', createdIso: '2026-01-02T00:00:00.000Z', parentSession: parentFile });
    const sessions = await listSessions(r);

    const lines = renderSwitcher(sessions, {
      width: 60,
      ascii: true,
      selectedId: null,
      liveIds: new Set(),
      pendingFocusId: null,
      errorMessage: null,
      dashboardRunning: true,
    });

    const nonAsciiRe = /[^\x00-\x7F]/;
    for (const line of lines) {
      expect(line).not.toMatch(nonAsciiRe);
    }
  });
});
