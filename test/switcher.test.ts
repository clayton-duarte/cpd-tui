import { describe, expect, it } from 'vitest';
import { visibleWidth } from '@earendil-works/pi-tui';
import type { PiSession } from '../src/sessions.ts';
import { renderSwitcher, relativeTime } from '../src/switcher-render.ts';
import { preserveSelectionById, nextSelectionAfterDeletion } from '../src/switcher-selection.ts';
import { SwitcherComponent, handleRowClick } from '../src/switcher.ts';
import { createFakeSwap } from '../src/swap-fake.ts';

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


describe('renderSwitcher row width', () => {
  it('never exceeds the given width, including at an absurdly narrow width', () => {
    const sessions = [
      makeSession({ id: 'a', label: '~/projects/card-dashboard' }),
      makeSession({ id: 'b', label: '~/.pi/agent' }),
      makeSession({ id: 'c', label: '~' }),
      makeSession({ id: 'd', label: '~/dotfiles-with-a-very-long-name-indeed' }),
    ];
    for (const width of [12, 17, 22, 40, 80]) {
      const lines = renderSwitcher(sessions, {
        width,
        ascii: false,
        selectedId: 'a',
        liveIds: new Set(['a', 'b']),
        pendingFocusId: null,
        errorMessage: null,
        dashboardRunning: true,
      });
      for (const line of lines) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
    }
  });
});

describe('renderSwitcher live vs dormant glyphs', () => {
  const sessions = [
    makeSession({ id: 'a', label: 'live-one' }),
    makeSession({ id: 'b', label: 'dormant-one' }),
  ];

  it('uses the live glyph for live sessions and dormant glyph otherwise (unicode)', () => {
    const lines = renderSwitcher(sessions, {
      width: 40,
      ascii: false,
      selectedId: null,
      liveIds: new Set(['a']),
      pendingFocusId: null,
      errorMessage: null,
      dashboardRunning: true,
    });
    const liveLine = lines.find((l) => l.includes('live-one'));
    const dormantLine = lines.find((l) => l.includes('dormant-one'));
    expect(liveLine).toContain('\u25cf');
    expect(dormantLine).toContain('\u25cb');
  });

  it('uses ASCII glyphs under CPD_ASCII (ascii=true)', () => {
    const lines = renderSwitcher(sessions, {
      width: 40,
      ascii: true,
      selectedId: null,
      liveIds: new Set(['a']),
      pendingFocusId: null,
      errorMessage: null,
      dashboardRunning: true,
    });
    const liveLine = lines.find((l) => l.includes('live-one'));
    const dormantLine = lines.find((l) => l.includes('dormant-one'));
    expect(liveLine).toContain('*');
    expect(dormantLine).toContain('o');
  });
});

describe('renderSwitcher ASCII mode produces pure ASCII output', () => {
  it('contains no codepoint above 127', () => {
    const sessions = [
      makeSession({ id: 'a', label: '~/projects/card-dashboard' }),
      makeSession({ id: 'b', label: '~/.pi/agent' }),
    ];
    const lines = renderSwitcher(sessions, {
      width: 30,
      ascii: true,
      selectedId: 'a',
      liveIds: new Set(['a']),
      pendingFocusId: 'b',
      errorMessage: null,
      dashboardRunning: true,
    });
    for (const line of lines) {
      for (const ch of line) {
        expect(ch.codePointAt(0)!).toBeLessThanOrEqual(127);
      }
    }
  });
});

describe('renderSwitcher empty and not-running states', () => {
  it('renders a dim message for an empty store', () => {
    const lines = renderSwitcher([], {
      width: 30,
      ascii: false,
      selectedId: null,
      liveIds: new Set(),
      pendingFocusId: null,
      errorMessage: null,
      dashboardRunning: true,
    });
    expect(lines.some((l) => l.includes('no pi sessions yet'))).toBe(true);
  });

  it('renders a clear message when the dashboard is not running', () => {
    const lines = renderSwitcher([], {
      width: 30,
      ascii: false,
      selectedId: null,
      liveIds: new Set(),
      pendingFocusId: null,
      errorMessage: null,
      dashboardRunning: false,
    });
    expect(lines.some((l) => l.includes('dashboard not running'))).toBe(true);
  });
});

describe('relativeTime', () => {
  it('formats seconds, minutes, hours, yesterday, and days', () => {
    const now = new Date('2026-01-10T12:00:00Z');
    expect(relativeTime(new Date('2026-01-10T11:59:50Z'), now)).toBe('10s');
    expect(relativeTime(new Date('2026-01-10T11:58:00Z'), now)).toBe('2m');
    expect(relativeTime(new Date('2026-01-10T09:00:00Z'), now)).toBe('3h');
    expect(relativeTime(new Date('2026-01-09T12:00:00Z'), now)).toBe('yesterday');
    expect(relativeTime(new Date('2026-01-05T12:00:00Z'), now)).toBe('5d');
  });
});

describe('preserveSelectionById — the reordering regression guard', () => {
  it('keeps the same session id selected after the list reorders', () => {
    const selectedId = 'c'; // was last
    const after = ['a', 'c', 'b']; // c moved to the middle after an update
    const result = preserveSelectionById(selectedId, after);
    expect(result).toBe('c');
  });

  it('falls back to the first session id when the selected id disappears', () => {
    const after = ['x', 'y'];
    const result = preserveSelectionById('gone', after);
    expect(result).toBe('x');
  });

  it('returns null when the list is empty', () => {
    const result = preserveSelectionById('a', []);
    expect(result).toBeNull();
  });

  it('keeps null selection as null when the list is non-empty on first render', () => {
    // Explicit "no prior selection" case should pick the first row.
    const result = preserveSelectionById(null, ['a', 'b']);
    expect(result).toBe('a');
  });
});

describe('nextSelectionAfterDeletion (the delete-selection regression guard)', () => {
  it('moves to the next row (same index) when a middle row is deleted', () => {
    const result = nextSelectionAfterDeletion('b', ['a', 'b', 'c'], ['a', 'c']);
    expect(result).toBe('c');
  });

  it('moves to the new last row when the last row is deleted', () => {
    const result = nextSelectionAfterDeletion('c', ['a', 'b', 'c'], ['a', 'b']);
    expect(result).toBe('b');
  });

  it('selects the first row when the first row is deleted', () => {
    const result = nextSelectionAfterDeletion('a', ['a', 'b', 'c'], ['b', 'c']);
    expect(result).toBe('b');
  });

  it('returns null when deleting the only row leaves the list empty', () => {
    const result = nextSelectionAfterDeletion('a', ['a'], []);
    expect(result).toBeNull();
  });
});

describe('handleRowClick — single click opens (T-CLICK)', () => {
  async function makeSwitcherWithSessions(ids: string[]): Promise<{
    switcher: SwitcherComponent;
    fake: ReturnType<typeof createFakeSwap>;
  }> {
    const fake = createFakeSwap();
    const switcher = new SwitcherComponent(fake, '/repo');
    await switcher.refresh(); // sessions=[] from empty disk root
    // Seed sessions directly (test-only access), mirroring how main() reads
    // switcher['selectedId'] via bracket access elsewhere in this codebase.
    (switcher as unknown as { sessions: PiSession[] })['sessions'] = ids.map((id) =>
      makeSession({ id }),
    );
    return { switcher, fake };
  }

  it('[A] click once on an UNSELECTED row -> exactly one focusSession for that row', async () => {
    const { switcher, fake } = await makeSwitcherWithSessions(['a', 'b']);
    let renders = 0;
    handleRowClick(switcher, 1, 1, () => renders++);
    await new Promise((r) => setTimeout(r, 0));
    expect(fake.focusCalls.map((s) => s.id)).toEqual(['b']);
    expect(renders).toBeGreaterThan(0);
  });

  it('[B] click once on the ALREADY-selected row -> still exactly one focusSession (no regression)', async () => {
    const { switcher, fake } = await makeSwitcherWithSessions(['a', 'b']);
    handleRowClick(switcher, 0, 1, () => {});
    await new Promise((r) => setTimeout(r, 0));
    handleRowClick(switcher, 0, 1, () => {});
    await new Promise((r) => setTimeout(r, 0));
    expect(fake.focusCalls.map((s) => s.id)).toEqual(['a', 'a']);
  });

  it('[C] double-click a row -> focusSession called exactly once, not twice', async () => {
    const { switcher, fake } = await makeSwitcherWithSessions(['a', 'b']);
    // Simulate two rapid click events composing a double-click: clickCount 1
    // then clickCount 2, both dispatched before the first focus resolves.
    handleRowClick(switcher, 0, 1, () => {});
    handleRowClick(switcher, 0, 2, () => {});
    await new Promise((r) => setTimeout(r, 0));
    expect(fake.focusCalls.length).toBe(1);
  });
});
