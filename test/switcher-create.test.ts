import { describe, it, expect } from 'vitest';
import { SwitcherComponent } from '../src/switcher.ts';
import { createFakeSwap } from '../src/swap-fake.ts';
import type { PiSession } from '../src/sessions.ts';

function makeSession(overrides: Partial<PiSession> & { id: string }): PiSession {
  return {
    file: `/tmp/${overrides.id}.jsonl`,
    cwd: '/home/user/projects/x',
    label: overrides.label ?? `~/projects/${overrides.id}`,
    created: overrides.created ?? new Date('2026-01-01T00:00:00Z'),
    updated: overrides.updated ?? new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('startCreate — $HOME is first and preselected', () => {
  it('[A] with a row selected -> $HOME is choices[0] and preselected', async () => {
    const swap = createFakeSwap();
    const switcher = new SwitcherComponent(swap, '/repo/root');
    // seed one session and select it
    (switcher as unknown as { sessions: PiSession[] }).sessions = [makeSession({ id: 'a', cwd: '/some/row/cwd' })];
    switcher.selectId('a');

    switcher.startCreate();
    const mode = switcher.getMode();
    expect(mode.kind).toBe('create-cwd');
    if (mode.kind !== 'create-cwd') throw new Error('unreachable');

    expect(mode.choices[0]!.cwd).toBe(process.env.HOME ?? '/');
    expect(mode.choices[mode.selectedIndex]!.cwd).toBe(process.env.HOME ?? '/');
  });

  it('[B] with no row selected -> $HOME is still first and preselected', () => {
    const swap = createFakeSwap();
    const switcher = new SwitcherComponent(swap, '/repo/root');

    switcher.startCreate();
    const mode = switcher.getMode();
    expect(mode.kind).toBe('create-cwd');
    if (mode.kind !== 'create-cwd') throw new Error('unreachable');

    expect(mode.choices[0]!.cwd).toBe(process.env.HOME ?? '/');
    expect(mode.choices[mode.selectedIndex]!.cwd).toBe(process.env.HOME ?? '/');
  });

  it('[C] all three choices are present (row selected)', () => {
    const swap = createFakeSwap();
    const switcher = new SwitcherComponent(swap, '/repo/root');
    (switcher as unknown as { sessions: PiSession[] }).sessions = [makeSession({ id: 'a', cwd: '/some/row/cwd' })];
    switcher.selectId('a');

    switcher.startCreate();
    const mode = switcher.getMode();
    if (mode.kind !== 'create-cwd') throw new Error('unreachable');

    const cwds = mode.choices.map((c) => c.cwd);
    expect(cwds).toEqual([process.env.HOME ?? '/', '/some/row/cwd', '/repo/root']);
  });

  it('[C] two choices are present (no row selected)', () => {
    const swap = createFakeSwap();
    const switcher = new SwitcherComponent(swap, '/repo/root');

    switcher.startCreate();
    const mode = switcher.getMode();
    if (mode.kind !== 'create-cwd') throw new Error('unreachable');

    const cwds = mode.choices.map((c) => c.cwd);
    expect(cwds).toEqual([process.env.HOME ?? '/', '/repo/root']);
  });

  it('[D] confirming the prompt creates the session with the $HOME cwd', async () => {
    const swap = createFakeSwap();
    const createCalls: string[] = [];
    const originalCreateSession = swap.createSession.bind(swap);
    swap.createSession = async (cwd: string) => {
      createCalls.push(cwd);
      return originalCreateSession(cwd);
    };
    const switcher = new SwitcherComponent(swap, '/repo/root');

    switcher.startCreate();
    await switcher.confirmCreate();

    expect(createCalls).toEqual([process.env.HOME ?? '/']);
  });
});
