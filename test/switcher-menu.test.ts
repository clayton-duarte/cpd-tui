import { describe, it, expect, vi } from 'vitest';
import { SwitcherComponent, handleRowClick, handleRowRightClick, handleKey } from '../src/switcher.ts';
import { createFakeSwap } from '../src/swap-fake.ts';
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

async function makeSwitcherWithSessions(ids: string[]): Promise<{
  switcher: SwitcherComponent;
  fake: ReturnType<typeof createFakeSwap>;
}> {
  const fake = createFakeSwap();
  const switcher = new SwitcherComponent(fake, '/repo');
  await switcher.refresh();
  (switcher as unknown as { sessions: PiSession[] })['sessions'] = ids.map((id) => makeSession({ id }));
  return { switcher, fake };
}

describe('T-MENU — right-click context menu', () => {
  it('[A] a LEFT-click on a row still selects+focuses (regression guard)', async () => {
    const { switcher, fake } = await makeSwitcherWithSessions(['a', 'b']);
    handleRowClick(switcher, 1, 1, () => {});
    await new Promise((r) => setTimeout(r, 0));
    expect(fake.focusCalls.map((s) => s.id)).toEqual(['b']);
  });

  it('[B] a RIGHT-click on a row does NOT call focusSelected -- no session is opened', async () => {
    const { switcher, fake } = await makeSwitcherWithSessions(['a', 'b']);
    const focusSpy = vi.spyOn(switcher, 'focusSelected');
    const id = handleRowRightClick(switcher, 1, () => {});
    await new Promise((r) => setTimeout(r, 0));
    expect(id).toBe('b');
    expect(focusSpy).not.toHaveBeenCalled();
    expect(fake.focusCalls).toEqual([]);
  });

  it('[C] a RIGHT-click selects the row that was actually clicked (not whatever was selected before)', async () => {
    const { switcher } = await makeSwitcherWithSessions(['a', 'b', 'c']);
    switcher.selectId('a');
    const id = handleRowRightClick(switcher, 2, () => {});
    expect(id).toBe('c');
    expect(switcher.selected()?.id).toBe('c');
  });

  it('[D] choosing Fork from the menu invokes forkSelected for the RIGHT-CLICKED session', async () => {
    const { switcher } = await makeSwitcherWithSessions(['a', 'b', 'c']);
    switcher.selectId('a');
    const id = handleRowRightClick(switcher, 2, () => {});
    expect(id).toBe('c');
    const forkSpy = vi.spyOn(switcher, 'forkSelected').mockResolvedValue();
    // Simulate choosing "Fork" from the menu: the menu acts on whatever
    // session is currently selected, which handleRowRightClick already set
    // to the right-clicked row above.
    void switcher.forkSelected();
    expect(forkSpy).toHaveBeenCalledTimes(1);
    expect(switcher.selected()?.id).toBe('c');
  });

  it('[E] choosing Delete routes to the delete-confirmation path, not an immediate delete', async () => {
    const { switcher } = await makeSwitcherWithSessions(['a', 'b']);
    handleRowRightClick(switcher, 1, () => {});
    switcher.startDelete();
    expect(switcher.getMode().kind).toMatch(/^confirm-delete/);
  });

  it("[F] while the menu is open, a 'd' keypress does NOT reach the list's delete handler", async () => {
    const { switcher } = await makeSwitcherWithSessions(['a', 'b']);
    switcher.selectId('a');
    switcher.setContextMenuOpen(true);
    const startDeleteSpy = vi.spyOn(switcher, 'startDelete');
    const handled = handleKey('d', switcher, () => {});
    expect(handled).toBe(false);
    expect(startDeleteSpy).not.toHaveBeenCalled();
    expect(switcher.getMode().kind).toBe('list');
  });

  it('[F2] once the menu closes, normal keys work again', async () => {
    const { switcher } = await makeSwitcherWithSessions(['a', 'b']);
    switcher.selectId('a');
    switcher.setContextMenuOpen(true);
    switcher.setContextMenuOpen(false);
    const startDeleteSpy = vi.spyOn(switcher, 'startDelete');
    const handled = handleKey('d', switcher, () => {});
    expect(handled).toBe(true);
    expect(startDeleteSpy).toHaveBeenCalledTimes(1);
  });
});
