import { tmux, tmuxOk } from './tmux.ts';
import type { PiSession } from './sessions.ts';

export interface CpdPane {
  paneId: string; // "%3"
  kind: 'switcher' | 'center' | 'slot' | 'parked' | null; // from @cpd_kind
  sessionId: string | null; // from @cpd_session; null if not a pi session pane
  window: string; // "dash" | "parked" | "parked-<prefix>"
  width: number;
  height: number;
  pid: number;
}

export class DashboardNotRunningError extends Error {
  constructor() {
    super('cpd dashboard is not running (no "cpd" tmux session on the cpd server). Start it with ./bin/cpd.');
    this.name = 'DashboardNotRunningError';
  }
}

const KINDS = new Set(['switcher', 'center', 'slot', 'parked']);

// Fields, in order: pane_id | window_name | pane_width | pane_height | pane_pid | @cpd_kind | @cpd_session
const PANE_FORMAT =
  '#{pane_id}|#{window_name}|#{pane_width}|#{pane_height}|#{pane_pid}|#{@cpd_kind}|#{@cpd_session}';

/** Pure parser for `tmux list-panes -F <PANE_FORMAT>` output. Exported for
 * unit testing without a running tmux server. */
export function parsePanesOutput(raw: string): CpdPane[] {
  const panes: CpdPane[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('|');
    if (parts.length < 7) continue;
    const [paneId, window, widthRaw, heightRaw, pidRaw, kindRaw, sessionIdRaw] = parts;
    const kind = KINDS.has(kindRaw) ? (kindRaw as CpdPane['kind']) : null;
    const sessionId = sessionIdRaw && sessionIdRaw.length > 0 ? sessionIdRaw : null;
    panes.push({
      paneId,
      kind,
      sessionId,
      window,
      width: Number(widthRaw),
      height: Number(heightRaw),
      pid: Number(pidRaw),
    });
  }
  return panes;
}

/** Pure helper: the window name used to park a given session, one window per
 * session (see Defect 1 — stacking panes in a single window hits a hard tmux
 * ceiling around 5-6 splits on a typical terminal height). Exported for unit
 * testing without a server. */
export function parkedWindowName(sessionId: string): string {
  return `parked-${sessionId.slice(0, 8)}`;
}

async function assertDashboardRunning(): Promise<void> {
  if (!(await isDashboardRunning())) {
    throw new DashboardNotRunningError();
  }
}

/** True when the cpd tmux server + dash window exist. */
export async function isDashboardRunning(): Promise<boolean> {
  return tmuxOk(['has-session', '-t', 'cpd']);
}

/** Every pane on the cpd server, with its tags resolved. */
export async function listPanes(): Promise<CpdPane[]> {
  await assertDashboardRunning();
  const raw = await tmux(['list-panes', '-a', '-t', 'cpd', '-F', PANE_FORMAT]);
  return parsePanesOutput(raw);
}

/** The pane currently occupying the center slot. Resolved fresh; never cached. */
export async function getCenterPane(): Promise<CpdPane> {
  const panes = await listPanes();
  const center = panes.find((p) => p.kind === 'center');
  if (!center) {
    throw new Error('No pane tagged @cpd_kind=center was found on the cpd server.');
  }
  return center;
}

/** Session ids that are live in a pane right now (center or parked). */
export async function liveSessionIds(): Promise<Set<string>> {
  const panes = await listPanes();
  const ids = new Set<string>();
  for (const p of panes) {
    if (p.sessionId) ids.add(p.sessionId);
  }
  return ids;
}

/** Decides whether a session is already running live (pure, given a pane
 * list), for unit testing without a server. */
export function findLivePane(panes: CpdPane[], sessionId: string): CpdPane | null {
  return panes.find((p) => p.sessionId === sessionId) ?? null;
}

/** Reduce an arbitrary error (including tmux's raw, often-truncated command-line
 * errors) to a short, readable message for the switcher footer. */
function shortErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (/no space for a new pane|no space/i.test(raw)) return "couldn't open session: no space";
  if (/can't find (window|pane|session)/i.test(raw)) return "couldn't open session: not found";
  // Generic fallback: never surface a raw truncated shell command line.
  return "couldn't open session: command failed";
}

/** Pins the target window to the center slot's current geometry, then swaps
 * `srcPaneId` (in its own parked window) into the center pane, and re-tags
 * both panes' @cpd_kind by their new location (see T4 ground-truth item 3: a
 * swap exchanges pane *locations*, so the role tag must be re-set on both ids
 * after every swap rather than assumed to "follow" the id). */
async function swapIntoCenter(srcPaneId: string, center: CpdPane): Promise<void> {
  await tmux(['resize-window', '-t', srcPaneId, '-x', String(center.width), '-y', String(center.height)]);
  await tmux(['swap-pane', '-d', '-s', srcPaneId, '-t', center.paneId]);
  // Re-tag by new location: srcPaneId now occupies the center slot, center.paneId
  // now sits in its own parked window.
  await tmux(['set', '-p', '-t', srcPaneId, '@cpd_kind', 'center']);
  await tmux(['set', '-p', '-t', center.paneId, '@cpd_kind', 'parked']);
}

/**
 * Bring a session into the center pane.
 * - live    -> swap its pane with the center pane
 * - dormant -> spawn `pi --session <file>` (cwd = session.cwd) in its own new
 *              parked window, then swap
 * Resolves once the session's pane IS the center pane. Resolves fresh state
 * every call (center pane id is never cached).
 */
export async function focusSession(session: PiSession): Promise<void> {
  try {
    await assertDashboardRunning();
    const panes = await listPanes();
    const center = panes.find((p) => p.kind === 'center');
    if (!center) {
      throw new Error('No pane tagged @cpd_kind=center was found on the cpd server.');
    }

    if (center.sessionId !== session.id) {
      const live = findLivePane(panes, session.id);
      if (live) {
        await swapIntoCenter(live.paneId, center);
      } else {
        // Dormant: spawn a new window (its own, not a split — see Defect 1)
        // running pi --session <file>, with cwd set to the session's cwd,
        // then swap it in.
        const windowName = parkedWindowName(session.id);
        const newPaneId = (
          await tmux([
            'new-window',
            '-d',
            '-t',
            'cpd',
            '-n',
            windowName,
            '-c',
            session.cwd,
            '-P',
            '-F',
            '#{pane_id}',
            'pi',
            '--session',
            session.file,
          ])
        ).trim();
        await tmux(['set', '-p', '-t', newPaneId, '@cpd_kind', 'parked']);
        await tmux(['set', '-p', '-t', newPaneId, '@cpd_session', session.id]);

        await swapIntoCenter(newPaneId, center);
      }
    }

    // Single common exit path: keyboard focus must always end up on the
    // center pane, whether we just got here or were already there.
    await tmux(['select-pane', '-t', center.paneId]);
  } catch (err) {
    throw new Error(shortErrorMessage(err));
  }
}

/**
 * Spawn a brand-new pi session (no --session flag) in its own parked window,
 * then swap it into the center. Returns the pane id so the caller can tag it
 * with the session id once the session's .jsonl file appears on disk (a new
 * session has no id until its first message is written).
 */
export async function createSession(cwd: string): Promise<{ paneId: string }> {
  try {
    await assertDashboardRunning();
    const panes = await listPanes();
    const center = panes.find((p) => p.kind === 'center');
    if (!center) {
      throw new Error('No pane tagged @cpd_kind=center was found on the cpd server.');
    }

    const windowName = `parked-new-${Date.now()}`;
    const newPaneId = (
      await tmux(['new-window', '-d', '-t', 'cpd', '-n', windowName, '-c', cwd, '-P', '-F', '#{pane_id}', 'pi'])
    ).trim();
    await tmux(['set', '-p', '-t', newPaneId, '@cpd_kind', 'parked']);

    await swapIntoCenter(newPaneId, center);
    await tmux(['select-pane', '-t', center.paneId]);
    return { paneId: center.paneId };
  } catch (err) {
    throw new Error(shortErrorMessage(err));
  }
}

/**
 * Fork an existing session via pi's native `--fork <path>` CLI flag, in its
 * own parked window (same spawn mechanism as createSession), then swap it
 * into the center. pi records the parentSession lineage itself -- no
 * bookkeeping here. Returns the pane id so the caller can tag it once the
 * forked session's .jsonl file appears on disk.
 */
export async function forkSession(sourceFile: string, cwd: string): Promise<{ paneId: string }> {
  try {
    await assertDashboardRunning();
    const panes = await listPanes();
    const center = panes.find((p) => p.kind === 'center');
    if (!center) {
      throw new Error('No pane tagged @cpd_kind=center was found on the cpd server.');
    }

    const windowName = `parked-fork-${Date.now()}`;
    const newPaneId = (
      await tmux([
        'new-window',
        '-d',
        '-t',
        'cpd',
        '-n',
        windowName,
        '-c',
        cwd,
        '-P',
        '-F',
        '#{pane_id}',
        'pi',
        '--fork',
        sourceFile,
      ])
    ).trim();
    await tmux(['set', '-p', '-t', newPaneId, '@cpd_kind', 'parked']);

    await swapIntoCenter(newPaneId, center);
    await tmux(['select-pane', '-t', center.paneId]);
    return { paneId: center.paneId };
  } catch (err) {
    throw new Error(shortErrorMessage(err));
  }
}

/** Tag a pane (by id) with a session id once it's known, e.g. after a newly
 * created session's .jsonl file finally appears. */
export async function tagPaneSession(paneId: string, sessionId: string): Promise<void> {
  await tmux(['set', '-p', '-t', paneId, '@cpd_session', sessionId]);
}

/** Select the switcher pane, giving it keyboard focus (the "way back" key). */
export async function focusSwitcher(): Promise<void> {
  const panes = await listPanes();
  const switcher = panes.find((p) => p.kind === 'switcher');
  if (!switcher) throw new Error('No pane tagged @cpd_kind=switcher was found on the cpd server.');
  await tmux(['select-pane', '-t', switcher.paneId]);
}

/** Close (kill) a parked window holding a live session's pane. Used by the
 * delete flow's "close it first" guard is enforced by the caller; this just
 * performs the kill once allowed. Never touches the dash window. */
export async function killParkedWindowForSession(sessionId: string): Promise<void> {
  const panes = await listPanes();
  const pane = panes.find((p) => p.sessionId === sessionId && p.kind === 'parked');
  if (!pane) return;
  await tmux(['kill-window', '-t', pane.paneId]);
}
