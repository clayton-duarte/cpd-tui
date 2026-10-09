#!/usr/bin/env node
import {
  ProcessTerminal,
  TuiAltScreen,
  Text,
  foregroundAnsi,
  rgbColor,
  visibleWidth,
  type TuiMouseEvent,
  type TuiMouseEventResult,
} from '@earendil-works/pi-tui';
import { listSessions, watchSessions, type PiSession } from './sessions.ts';
import { renderSwitcher } from './switcher-render.ts';
import type { SwitcherModeKind } from './switcher-render.ts';
import { preserveSelectionById, nextSelectionAfterDeletion } from './switcher-selection.ts';
import { assertDeletable, trashSessionFile, defaultTrashRoot, LiveSessionDeleteError } from './delete.ts';
import { loadSwap } from './swap-loader.ts';
import type { SwapModule } from './swap-contract.ts';

const ASCII_MODE = process.env.CPD_ASCII === '1';
const SESSIONS_ROOT = process.env.HOME ? `${process.env.HOME}/.pi/agent/sessions` : '';
const ERROR_DISPLAY_MS = 4000;
const LIVENESS_POLL_MS = 2500;

const DIM = (text: string): string => foregroundAnsi(rgbColor(120, 120, 130), 'truecolor') + text;
const BOLD_RESET = '\x1b[0m';

export type CreateCwdChoice = { label: string; cwd: string };

type Mode =
  | { kind: 'list' }
  | { kind: 'confirm-delete'; sessionId: string; label: string }
  | { kind: 'confirm-delete-live'; sessionId: string; label: string }
  | { kind: 'create-cwd'; choices: CreateCwdChoice[]; selectedIndex: number };

// Drift guard: a new Mode whose kind the renderer doesn't know about fails here.
type _ModeKindsAreRenderable = Mode['kind'] extends SwitcherModeKind ? true : never;
const _modeKindsAreRenderable: _ModeKindsAreRenderable = true;
void _modeKindsAreRenderable;

export class SwitcherComponent {
  private sessions: PiSession[] = [];
  private selectedId: string | null = null;
  private liveIds: Set<string> = new Set();
  private pendingFocusId: string | null = null;
  private errorMessage: string | null = null;
  private errorTimer: NodeJS.Timeout | null = null;
  private dashboardRunning = true;
  private mode: Mode = { kind: 'list' };
  /** Local overrides so a brand-new session shows as live immediately, before
   * its .jsonl file appears in listSessions() (Defect 4's "subtle part"). */
  private pendingNewSessions: Map<string, { paneId: string; cwd: string; createdAt: number }> = new Map();

  private readonly swap: SwapModule;
  private readonly repoRoot: string;

  constructor(swap: SwapModule, repoRoot: string) {
    this.swap = swap;
    this.repoRoot = repoRoot;
  }

  async refresh(): Promise<void> {
    try {
      this.dashboardRunning = await this.swap.isDashboardRunning();
    } catch {
      this.dashboardRunning = false;
    }

    const diskSessions = await listSessions(SESSIONS_ROOT || undefined);

    // Reconcile pending new sessions: once a disk session with a matching
    // pane-tagged id shows up, drop the synthetic placeholder rather than
    // showing both (no duplicate, no vanish).
    let liveIdsFromSwap: Set<string>;
    try {
      liveIdsFromSwap = await this.swap.liveSessionIds();
    } catch {
      liveIdsFromSwap = new Set();
    }
    for (const [placeholderId] of this.pendingNewSessions) {
      if (liveIdsFromSwap.has(placeholderId) || diskSessions.some((s) => s.id === placeholderId)) {
        // Real session now known under its real id (tagPaneSession already
        // ran); safe to drop the placeholder.
        this.pendingNewSessions.delete(placeholderId);
      }
    }

    const placeholderSessions: PiSession[] = [...this.pendingNewSessions.entries()].map(([id, info]) => ({
      id,
      file: '',
      cwd: info.cwd,
      label: 'new session',
      created: new Date(info.createdAt),
      updated: new Date(),
    }));

    this.sessions = [...placeholderSessions, ...diskSessions];
    this.selectedId = preserveSelectionById(
      this.selectedId,
      this.sessions.map((s) => s.id),
    );

    this.liveIds = new Set([...liveIdsFromSwap, ...this.pendingNewSessions.keys()]);
  }

  moveSelection(delta: 1 | -1): void {
    if (this.sessions.length === 0) return;
    const ids = this.sessions.map((s) => s.id);
    const currentIndex = this.selectedId ? ids.indexOf(this.selectedId) : -1;
    const baseIndex = currentIndex === -1 ? 0 : currentIndex;
    const nextIndex = (baseIndex + delta + ids.length) % ids.length;
    this.selectedId = ids[nextIndex]!;
  }

  selectId(id: string): void {
    if (this.sessions.some((s) => s.id === id)) {
      this.selectedId = id;
    }
  }

  selected(): PiSession | undefined {
    return this.sessions.find((s) => s.id === this.selectedId);
  }

  async focusSelected(): Promise<void> {
    const session = this.selected();
    if (!session) return;
    if (this.pendingFocusId === session.id) return; // already in flight
    this.pendingFocusId = session.id;
    try {
      await this.swap.focusSession(session);
    } catch (err) {
      this.showError(err instanceof Error ? err.message : String(err));
    } finally {
      if (this.pendingFocusId === session.id) {
        this.pendingFocusId = null;
      }
    }
  }

  /** Enter the create-new-session cwd prompt (Defect 4), escapable with Esc. */
  startCreate(): void {
    const selected = this.selected();
    const choices: CreateCwdChoice[] = [];
    const home = process.env.HOME ?? '/';
    choices.push({ label: `$HOME (${home})`, cwd: home });
    if (selected) choices.push({ label: `selected row's cwd (${selected.cwd})`, cwd: selected.cwd });
    choices.push({ label: `repo root (${this.repoRoot})`, cwd: this.repoRoot });
    this.mode = { kind: 'create-cwd', choices, selectedIndex: 0 };
  }

  moveCreatePrompt(delta: 1 | -1): void {
    if (this.mode.kind !== 'create-cwd') return;
    const { choices, selectedIndex } = this.mode;
    const next = (selectedIndex + delta + choices.length) % choices.length;
    this.mode = { ...this.mode, selectedIndex: next };
  }

  cancelPrompt(): void {
    this.mode = { kind: 'list' };
  }

  async confirmCreate(): Promise<void> {
    if (this.mode.kind !== 'create-cwd') return;
    const choice = this.mode.choices[this.mode.selectedIndex]!;
    this.mode = { kind: 'list' };
    try {
      const { paneId } = await this.swap.createSession(choice.cwd);
      // Synthetic id: unique, pane-scoped, and reconciled away once the real
      // session's .jsonl file (and its real id) shows up in listSessions().
      const placeholderId = `pending:${paneId}:${Date.now()}`;
      this.pendingNewSessions.set(placeholderId, { paneId, cwd: choice.cwd, createdAt: Date.now() });
      this.liveIds.add(placeholderId);
      this.selectedId = placeholderId;
    } catch (err) {
      this.showError(err instanceof Error ? err.message : String(err));
    }
  }

  /** Enter the delete-confirmation prompt (Defect 5), escapable with Esc.
   * A live session (currently occupying a pane) gets the "close it and
   * delete?" variant instead of a dead-end refusal. */
  startDelete(): void {
    const session = this.selected();
    if (!session) return;
    if (this.liveIds.has(session.id)) {
      this.mode = { kind: 'confirm-delete-live', sessionId: session.id, label: session.label };
    } else {
      this.mode = { kind: 'confirm-delete', sessionId: session.id, label: session.label };
    }
  }

  private trashSession(sessionId: string): void {
    const session = this.sessions.find((s) => s.id === sessionId);
    if (!session) return;
    trashSessionFile(session.file, { trashRoot: defaultTrashRoot() });
    const beforeIds = this.sessions.map((s) => s.id);
    this.sessions = this.sessions.filter((s) => s.id !== sessionId);
    const afterIds = this.sessions.map((s) => s.id);
    this.selectedId = nextSelectionAfterDeletion(sessionId, beforeIds, afterIds);
  }

  async confirmDelete(): Promise<void> {
    if (this.mode.kind !== 'confirm-delete') return;
    const { sessionId } = this.mode;
    this.mode = { kind: 'list' };
    const session = this.sessions.find((s) => s.id === sessionId);
    if (!session) return;
    try {
      assertDeletable(sessionId, this.liveIds);
    } catch (err) {
      if (err instanceof LiveSessionDeleteError) {
        this.showError(err.message);
      } else {
        this.showError(err instanceof Error ? err.message : String(err));
      }
      return;
    }
    try {
      this.trashSession(sessionId);
    } catch (err) {
      this.showError(err instanceof Error ? err.message : String(err));
    }
  }

  /** Confirm the "close it and delete?" prompt for a LIVE session: close the
   * session's pane FIRST (never kill pi silently — only on explicit confirm),
   * then run the normal trash flow. On cancel (handled by cancelPrompt), no
   * changes happen at all. */
  async confirmDeleteLive(): Promise<void> {
    if (this.mode.kind !== 'confirm-delete-live') return;
    const { sessionId } = this.mode;
    this.mode = { kind: 'list' };
    const session = this.sessions.find((s) => s.id === sessionId);
    if (!session) return;
    try {
      await this.swap.killParkedWindowForSession(sessionId);
      this.liveIds.delete(sessionId);
      this.trashSession(sessionId);
    } catch (err) {
      this.showError(err instanceof Error ? err.message : String(err));
    }
  }

  getMode(): Mode {
    return this.mode;
  }

  private showError(message: string): void {
    this.errorMessage = message;
    if (this.errorTimer) clearTimeout(this.errorTimer);
    this.errorTimer = setTimeout(() => {
      this.errorMessage = null;
      this.errorTimer = null;
    }, ERROR_DISPLAY_MS);
  }

  render(width: number): string[] {
    const lines = renderSwitcher(this.sessions, {
      width,
      ascii: ASCII_MODE,
      selectedId: this.selectedId,
      liveIds: this.liveIds,
      pendingFocusId: this.pendingFocusId,
      errorMessage: this.errorMessage,
      dashboardRunning: this.dashboardRunning,
      mode: this.mode.kind,
    });

    if (this.mode.kind === 'confirm-delete') {
      lines.push(clamp(`delete "${this.mode.label}"? y/n`, width));
    } else if (this.mode.kind === 'confirm-delete-live') {
      lines.push(clamp(`"${this.mode.label}" is open. Close it and delete? (y/N)`, width));
    } else if (this.mode.kind === 'create-cwd') {
      lines.push(clamp('new session cwd (\u2191/\u2193 choose, Enter confirm, Esc cancel):', width));
      this.mode.choices.forEach((choice, i) => {
        const marker = i === (this.mode as Extract<Mode, { kind: 'create-cwd' }>).selectedIndex ? '> ' : '  ';
        lines.push(clamp(`${marker}${choice.label}`, width));
      });
    }

    return lines;
  }

  /** Row index (0-based, within the sessions list) a given render-line index
   * corresponds to, or null if it's outside the session rows. Pure so it's
   * testable without a terminal. */
  rowIndexForLine(lineIndex: number): number | null {
    // renderSwitcher layout: title, blank, N session rows, blank, footer...
    const headerLines = 2;
    const idx = lineIndex - headerLines;
    if (idx < 0 || idx >= this.sessions.length) return null;
    return idx;
  }

  sessionCount(): number {
    return this.sessions.length;
  }

  sessionIdAt(rowIndex: number): string | undefined {
    return this.sessions[rowIndex]?.id;
  }
}

function clamp(line: string, width: number): string {
  return visibleWidth(line) <= width ? line : line.slice(0, Math.max(0, width));
}

class SwitcherTextComponent implements Pick<Text, 'render' | 'invalidate'> {
  private readonly switcher: SwitcherComponent;
  private readonly onRowClick: (rowIndex: number, clickCount: number) => void;

  constructor(switcher: SwitcherComponent, onRowClick: (rowIndex: number, clickCount: number) => void) {
    this.switcher = switcher;
    this.onRowClick = onRowClick;
  }

  render(width: number): string[] {
    return this.switcher.render(width);
  }
  invalidate(): void {
    // no cached state to invalidate
  }
  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (event.type === 'wheel') {
      // Scroll handling is delegated to the outer ScrollView/viewport; just
      // mark handled so it doesn't fall through to text selection.
      return { handled: true, render: false };
    }
    if (event.type !== 'click') return undefined;
    const rowIndex = this.switcher.rowIndexForLine(event.y);
    if (rowIndex === null) return undefined;
    this.onRowClick(rowIndex, event.clickCount ?? 1);
    return { handled: true, render: true };
  }
}

/** Row-click handler: a single click on ANY row selects and focuses that
 * session (one click = select + open). The in-flight guard in
 * SwitcherComponent.focusSelected() (via pendingFocusId) prevents a
 * double-click's second click from firing a second focus call. */
export function handleRowClick(
  switcher: SwitcherComponent,
  rowIndex: number,
  _clickCount: number,
  onRender: () => void,
): void {
  const id = switcher.sessionIdAt(rowIndex);
  if (!id) return;
  switcher.selectId(id);
  onRender();
  void switcher.focusSelected().then(() => onRender());
}

function resolveRepoRoot(): string {
  // bin/cpd resolves the repo root from its own location; switcher.ts lives
  // one directory below it (src/), so mirror that: go up one from this file.
  const here = new URL('.', import.meta.url).pathname;
  return new URL('..', `file://${here}`).pathname.replace(/\/$/, '');
}

async function main(): Promise<void> {
  const swap = await loadSwap();
  const repoRoot = resolveRepoRoot();
  const switcher = new SwitcherComponent(swap, repoRoot);
  await switcher.refresh();

  const terminal = new ProcessTerminal();
  const ui = new TuiAltScreen(terminal, false, undefined, { mouse: true });
  const component = new SwitcherTextComponent(switcher, (rowIndex, clickCount) => {
    handleRowClick(switcher, rowIndex, clickCount, () => ui.requestRender());
  });
  ui.setLayoutRoot(component as unknown as Parameters<typeof ui.setLayoutRoot>[0]);

  let stopped = false;
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    ui.stop();
    process.exit(0);
  };

  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  const watcher = watchSessions(SESSIONS_ROOT, () => {
    void switcher.refresh().then(() => ui.requestRender());
  });

  // Also-fix: liveness goes stale until 'r' is pressed because swapping
  // touches no session file. Re-poll on a short timer in addition to the
  // file watcher and after focus/create/delete.
  const livenessTimer = setInterval(() => {
    void switcher.refresh().then(() => ui.requestRender());
  }, LIVENESS_POLL_MS);

  process.stdin.on('data', (data: Buffer) => {
    const key = data.toString('utf8');
    const mode = switcher.getMode();

    if (mode.kind === 'confirm-delete') {
      if (key === 'y' || key === 'Y') {
        void switcher.confirmDelete().then(() => ui.requestRender());
        return;
      }
      if (key === 'n' || key === 'N' || key === '\u001b') {
        switcher.cancelPrompt();
        ui.requestRender();
        return;
      }
      return;
    }

    if (mode.kind === 'confirm-delete-live') {
      if (key === 'y' || key === 'Y') {
        void switcher.confirmDeleteLive().then(() => ui.requestRender());
        return;
      }
      // Default is NO: Esc, 'n'/'N', or anything else cancels with no changes.
      switcher.cancelPrompt();
      ui.requestRender();
      return;
    }

    if (mode.kind === 'create-cwd') {
      if (key === '\u001b') {
        switcher.cancelPrompt();
        ui.requestRender();
        return;
      }
      if (key === 'j' || key === '\u001b[B') {
        switcher.moveCreatePrompt(1);
        ui.requestRender();
        return;
      }
      if (key === 'k' || key === '\u001b[A') {
        switcher.moveCreatePrompt(-1);
        ui.requestRender();
        return;
      }
      if (key === '\r' || key === '\n') {
        void switcher.confirmCreate().then(() => ui.requestRender());
        return;
      }
      return;
    }

    if (key === 'q' || key === '\u0003') {
      clearInterval(livenessTimer);
      watcher.close();
      stop();
      return;
    }
    if (key === 'j' || key === '\u001b[B') {
      switcher.moveSelection(1);
      ui.requestRender();
      return;
    }
    if (key === 'k' || key === '\u001b[A') {
      switcher.moveSelection(-1);
      ui.requestRender();
      return;
    }
    if (key === 'r') {
      void switcher.refresh().then(() => ui.requestRender());
      return;
    }
    if (key === 'n') {
      switcher.startCreate();
      ui.requestRender();
      return;
    }
    if (key === 'd') {
      switcher.startDelete();
      ui.requestRender();
      return;
    }
    if (key === '\r' || key === '\n') {
      void switcher
        .focusSelected()
        .then(() => switcher.refresh())
        .then(() => ui.requestRender());
      ui.requestRender();
      return;
    }
  });

  ui.start();
  ui.requestRender(true);
}

main().catch((err) => {
  // Never crash the pane silently — print and exit so tmux shows the error.
  console.error(err);
  process.exit(1);
});
