import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parsePanesOutput, findLivePane, parkedWindowName, type CpdPane } from '../src/swap.ts';

describe('parsePanesOutput', () => {
  it('parses a well-formed list-panes -F line into CpdPane[]', () => {
    const raw = [
      '%0|dash|22|50|1001|switcher|',
      '%2|dash|48|50|1002|center|abc-123',
      '%3|dash|30|50|1003|slot|',
      '%1|parked|160|45|1004|parked|def-456',
    ].join('\n');

    const panes = parsePanesOutput(raw);

    expect(panes).toEqual<CpdPane[]>([
      { paneId: '%0', kind: 'switcher', sessionId: null, window: 'dash', width: 22, height: 50, pid: 1001 },
      { paneId: '%2', kind: 'center', sessionId: 'abc-123', window: 'dash', width: 48, height: 50, pid: 1002 },
      { paneId: '%3', kind: 'slot', sessionId: null, window: 'dash', width: 30, height: 50, pid: 1003 },
      { paneId: '%1', kind: 'parked', sessionId: 'def-456', window: 'parked', width: 160, height: 45, pid: 1004 },
    ]);
  });

  it('treats an unrecognized @cpd_kind value as null rather than crashing', () => {
    const raw = '%5|dash|40|50|1005|garbage|';
    const panes = parsePanesOutput(raw);
    expect(panes).toHaveLength(1);
    expect(panes[0].kind).toBeNull();
  });

  it('skips blank lines and short/malformed lines', () => {
    const raw = ['', '%0|dash|22|50|1001|switcher|', 'not-enough-fields'].join('\n');
    const panes = parsePanesOutput(raw);
    expect(panes).toHaveLength(1);
    expect(panes[0].paneId).toBe('%0');
  });
});

describe('parkedWindowName (window-per-session targeting)', () => {
  it('derives a short, stable window name from the session id prefix', () => {
    expect(parkedWindowName('abc12345-def6-7890-aaaa-bbbbccccdddd')).toBe('parked-abc12345');
  });

  it('produces distinct names for distinct session ids (no collisions -> no single-window ceiling)', () => {
    const names = new Set(
      ['aaaaaaaa-1', 'bbbbbbbb-2', 'cccccccc-3', 'dddddddd-4', 'eeeeeeee-5', 'ffffffff-6'].map(
        parkedWindowName,
      ),
    );
    expect(names.size).toBe(6);
  });
});

describe('findLivePane (live vs dormant decision)', () => {
  const panes: CpdPane[] = [
    { paneId: '%0', kind: 'switcher', sessionId: null, window: 'dash', width: 22, height: 50, pid: 1 },
    { paneId: '%2', kind: 'center', sessionId: 'live-session', window: 'dash', width: 48, height: 50, pid: 2 },
    { paneId: '%1', kind: 'parked', sessionId: 'parked-session', window: 'parked', width: 160, height: 45, pid: 3 },
  ];

  it('finds a live pane by session id regardless of whether it is centered or parked', () => {
    expect(findLivePane(panes, 'live-session')?.paneId).toBe('%2');
    expect(findLivePane(panes, 'parked-session')?.paneId).toBe('%1');
  });

  it('returns null for a session with no live pane (dormant), proving the dormant path is chosen', () => {
    expect(findLivePane(panes, 'does-not-exist')).toBeNull();
  });
});

// --- focusSession: fakes tmux command execution, asserts on recorded argv ---
vi.mock('../src/tmux.ts', () => {
  return {
    tmux: vi.fn(),
    tmuxOk: vi.fn(async () => true),
  };
});

describe('focusSession (center-pane keyboard focus)', () => {
  const CENTER_PANE_ID = '%2';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function setupMockTmux(panesRaw: string, opts: { newPaneId?: string } = {}) {
    const tmuxMod = await import('../src/tmux.ts');
    const recorded: string[][] = [];
    (tmuxMod.tmux as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (args: string[]) => {
      recorded.push(args);
      if (args[0] === 'list-panes') return panesRaw;
      if (args[0] === 'new-window') return (opts.newPaneId ?? '%9') + '\n';
      return '';
    });
    return recorded;
  }

  it('[A] session is ALREADY the center pane -> still records select-pane on center (regression under test)', async () => {
    const panesRaw = `${CENTER_PANE_ID}|dash|48|50|1002|center|already-centered`;
    const recorded = await setupMockTmux(panesRaw);
    const { focusSession } = await import('../src/swap.ts');

    await focusSession({ id: 'already-centered', file: '/tmp/a.jsonl', cwd: '/tmp' } as any);

    expect(recorded.some((args) => args[0] === 'select-pane' && args.includes(CENTER_PANE_ID))).toBe(true);
  });

  it('[B] session is live in another pane -> swap happens AND select-pane on center', async () => {
    const panesRaw = [
      `${CENTER_PANE_ID}|dash|48|50|1002|center|someone-else`,
      '%3|parked|160|45|1003|parked|live-elsewhere',
    ].join('\n');
    const recorded = await setupMockTmux(panesRaw);
    const { focusSession } = await import('../src/swap.ts');

    await focusSession({ id: 'live-elsewhere', file: '/tmp/b.jsonl', cwd: '/tmp' } as any);

    expect(recorded.some((args) => args[0] === 'swap-pane')).toBe(true);
    expect(recorded.some((args) => args[0] === 'select-pane' && args.includes(CENTER_PANE_ID))).toBe(true);
  });

  it('[C] session is dormant -> respawn path also ends with select-pane on center', async () => {
    const panesRaw = `${CENTER_PANE_ID}|dash|48|50|1002|center|someone-else`;
    const recorded = await setupMockTmux(panesRaw, { newPaneId: '%9' });
    const { focusSession } = await import('../src/swap.ts');

    await focusSession({ id: 'dormant-session', file: '/tmp/c.jsonl', cwd: '/tmp' } as any);

    expect(recorded.some((args) => args[0] === 'new-window')).toBe(true);
    expect(recorded.some((args) => args[0] === 'swap-pane')).toBe(true);
    expect(recorded.some((args) => args[0] === 'select-pane' && args.includes(CENTER_PANE_ID))).toBe(true);
  });
});
