import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { SwitcherComponent } from '../src/switcher.ts';
import { createFakeSwap } from '../src/swap-fake.ts';
import { renderListHint } from '../src/switcher-render.ts';
import { makeFixtureRoot, writeSessionFixture } from './fixtures.ts';
import type { PiSession } from '../src/sessions.ts';

function makeSession(overrides: Partial<PiSession> & { id: string }): PiSession {
  return {
    file: `/tmp/${overrides.id}.jsonl`,
    cwd: '/home/user/projects/x',
    label: overrides.label ?? `~/projects/${overrides.id}`,
    created: overrides.created ?? new Date('2026-01-01T00:00:00Z'),
    updated: overrides.updated ?? new Date('2026-01-01T00:00:00Z'),
    parentPath: overrides.parentPath ?? null,
    ...overrides,
  };
}

describe('forkSelected — fork the selected session via pi --fork', () => {
  it('[A] pressing fork on a selected session invokes forkSession with that session\'s absolute path', async () => {
    const swap = createFakeSwap();
    const forkCalls: Array<{ file: string; cwd: string }> = [];
    swap.forkSession = async (sourceFile: string, cwd: string) => {
      forkCalls.push({ file: sourceFile, cwd });
      return { paneId: '%1' };
    };
    const switcher = new SwitcherComponent(swap, '/repo/root');
    (switcher as unknown as { sessions: PiSession[] }).sessions = [
      makeSession({ id: 'a', file: '/abs/path/a.jsonl', cwd: '/abs/path' }),
    ];
    switcher.selectId('a');

    await switcher.forkSelected();

    expect(forkCalls).toEqual([{ file: '/abs/path/a.jsonl', cwd: '/abs/path' }]);
  });

  it('[B] pressing fork with NO session selected does nothing -- no spawn call at all', async () => {
    const swap = createFakeSwap();
    const forkCalls: Array<{ file: string; cwd: string }> = [];
    swap.forkSession = async (sourceFile: string, cwd: string) => {
      forkCalls.push({ file: sourceFile, cwd });
      return { paneId: '%1' };
    };
    const switcher = new SwitcherComponent(swap, '/repo/root');

    await switcher.forkSelected();

    expect(forkCalls).toEqual([]);
  });

  it('[C] the bottom hint line lists the fork key', () => {
    const hint = renderListHint(200, false);
    expect(hint).toContain('f fork');
  });

  it('[D] fork does not mutate or delete the SOURCE session file', async () => {
    const root = makeFixtureRoot();
    const sourceFile = writeSessionFixture({ root, cwd: '/some/cwd', id: 'src-1' });
    const before = readFileSync(sourceFile, 'utf8');

    const swap = createFakeSwap();
    swap.forkSession = async () => ({ paneId: '%1' });
    const switcher = new SwitcherComponent(swap, '/repo/root');
    (switcher as unknown as { sessions: PiSession[] }).sessions = [
      makeSession({ id: 'src-1', file: sourceFile, cwd: '/some/cwd' }),
    ];
    switcher.selectId('src-1');

    await switcher.forkSelected();

    const after = readFileSync(sourceFile, 'utf8');
    expect(after).toBe(before);
  });
});
