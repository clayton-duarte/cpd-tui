import { describe, it, expect, vi } from 'vitest';
import { SwitcherComponent, handleKey } from '../src/switcher.ts';
import { createFakeSwap } from '../src/swap-fake.ts';
import { renderListHint } from '../src/switcher-render.ts';
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

function makeSwitcherWithSelection(): SwitcherComponent {
  const swap = createFakeSwap();
  const switcher = new SwitcherComponent(swap, '/repo/root');
  (switcher as unknown as { sessions: PiSession[] }).sessions = [
    makeSession({ id: 'a', file: '/abs/path/a.jsonl', cwd: '/abs/path' }),
  ];
  switcher.selectId('a');
  return switcher;
}

describe('handleKey — top-level key dispatch', () => {
  it("[A] 'f' invokes forkSelected (and nothing else)", async () => {
    const switcher = makeSwitcherWithSelection();
    const forkSpy = vi.spyOn(switcher, 'forkSelected').mockResolvedValue();
    const startCreateSpy = vi.spyOn(switcher, 'startCreate');
    const startDeleteSpy = vi.spyOn(switcher, 'startDelete');
    const refreshSpy = vi.spyOn(switcher, 'refresh').mockResolvedValue();
    const onRender = vi.fn();

    const handled = handleKey('f', switcher, onRender);

    expect(handled).toBe(true);
    expect(forkSpy).toHaveBeenCalledTimes(1);
    expect(startCreateSpy).not.toHaveBeenCalled();
    expect(startDeleteSpy).not.toHaveBeenCalled();
    expect(refreshSpy).not.toHaveBeenCalled();
  });

  it("[B] 'n' starts the create-cwd prompt", () => {
    const switcher = makeSwitcherWithSelection();
    const startCreateSpy = vi.spyOn(switcher, 'startCreate');
    const onRender = vi.fn();

    const handled = handleKey('n', switcher, onRender);

    expect(handled).toBe(true);
    expect(startCreateSpy).toHaveBeenCalledTimes(1);
    expect(onRender).toHaveBeenCalled();
  });

  it("[C] 'd' starts the delete prompt", () => {
    const switcher = makeSwitcherWithSelection();
    const startDeleteSpy = vi.spyOn(switcher, 'startDelete');
    const onRender = vi.fn();

    const handled = handleKey('d', switcher, onRender);

    expect(handled).toBe(true);
    expect(startDeleteSpy).toHaveBeenCalledTimes(1);
    expect(onRender).toHaveBeenCalled();
  });

  it("[D] 'r' refreshes", () => {
    const switcher = makeSwitcherWithSelection();
    const refreshSpy = vi.spyOn(switcher, 'refresh').mockResolvedValue();
    const onRender = vi.fn();

    const handled = handleKey('r', switcher, onRender);

    expect(handled).toBe(true);
    expect(refreshSpy).toHaveBeenCalledTimes(1);
  });

  it("[E] an unbound key (e.g. 'z') is a no-op and returns false", () => {
    const switcher = makeSwitcherWithSelection();
    const forkSpy = vi.spyOn(switcher, 'forkSelected');
    const startCreateSpy = vi.spyOn(switcher, 'startCreate');
    const startDeleteSpy = vi.spyOn(switcher, 'startDelete');
    const refreshSpy = vi.spyOn(switcher, 'refresh');
    const onRender = vi.fn();

    const handled = handleKey('z', switcher, onRender);

    expect(handled).toBe(false);
    expect(forkSpy).not.toHaveBeenCalled();
    expect(startCreateSpy).not.toHaveBeenCalled();
    expect(startDeleteSpy).not.toHaveBeenCalled();
    expect(refreshSpy).not.toHaveBeenCalled();
    expect(onRender).not.toHaveBeenCalled();
  });

  it('[F] DRIFT GUARD: every key advertised in renderListHint() is handled by handleKey()', () => {
    const hint = renderListHint(200, false);
    // Each hint segment looks like "<key> <label>" (or the move arrows segment,
    // which isn't a literal keypress token and is excluded). Extract the
    // single-character key token from every segment and assert handleKey()
    // reports it as handled.
    const segments = hint.split(' \u00b7 ');
    const keyTokens = segments
      .map((segment) => segment.trim().split(/\s+/)[0]!)
      .filter((token) => token.length === 1);

    expect(keyTokens.length).toBeGreaterThan(0);

    for (const token of keyTokens) {
      const switcher = makeSwitcherWithSelection();
      vi.spyOn(switcher, 'forkSelected').mockResolvedValue();
      vi.spyOn(switcher, 'refresh').mockResolvedValue();
      const handled = handleKey(token, switcher, () => {});
      expect(handled, `key '${token}' advertised in hint but not handled`).toBe(true);
    }
  });
});
