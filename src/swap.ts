import { tmux, tmuxOk } from './tmux.ts';
import type { PiSession } from './sessions.ts';

export interface CpdPane {
  paneId: string; // "%3"
  kind: 'switcher' | 'center' | 'slot' | 'parked' | null; // from @cpd_kind
  sessionId: string | null; // from @cpd_session; null if not a pi session pane
  window: string; // "dash" | "parked"
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

/** Pins the parked window to the center slot's current geometry, then swaps
 * `srcId` (in the parked window) into the center pane, and re-tags both
 * panes' @cpd_kind by their new location (see T4 ground-truth item 3: a swap
 * exchanges pane *locations*, so the role tag must be re-set on both ids
 * after every swap rather than assumed to "follow" the id). */
async function swapIntoCenter(srcId: string, center: CpdPane): Promise<void> {
  await tmux(['resize-window', '-t', 'cpd:parked', '-x', String(center.width), '-y', String(center.height)]);
  await tmux(['swap-pane', '-d', '-s', srcId, '-t', center.paneId]);
  // Re-tag by new location: srcId now occupies the center slot, center.paneId
  // now sits in the parked window.
  await tmux(['set', '-p', '-t', srcId, '@cpd_kind', 'center']);
  await tmux(['set', '-p', '-t', center.paneId, '@cpd_kind', 'parked']);
}

/**
 * Bring a session into the center pane.
 * - live    -> swap its pane with the center pane
 * - dormant -> spawn `pi --session <file>` (cwd = session.cwd) in the parked window, then swap
 * Resolves once the session's pane IS the center pane.
 */
export async function focusSession(session: PiSession): Promise<void> {
  await assertDashboardRunning();
  const panes = await listPanes();
  const center = panes.find((p) => p.kind === 'center');
  if (!center) {
    throw new Error('No pane tagged @cpd_kind=center was found on the cpd server.');
  }

  if (center.sessionId === session.id) {
    // Already centered; nothing to do.
    return;
  }

  const live = findLivePane(panes, session.id);
  if (live) {
    await swapIntoCenter(live.paneId, center);
    return;
  }

  // Dormant: spawn a new pane in the parked window running pi --session <file>,
  // with cwd set to the session's cwd, then swap it in.
  const newPaneId = (
    await tmux([
      'split-window',
      '-d',
      '-t',
      'cpd:parked',
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
