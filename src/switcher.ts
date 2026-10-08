#!/usr/bin/env node
import {
  ProcessTerminal,
  TuiAltScreen,
  Text,
  foregroundAnsi,
  rgbColor,
  visibleWidth,
} from '@earendil-works/pi-tui';
import { listSessions, watchSessions, type PiSession } from './sessions.ts';
import { renderSwitcher } from './switcher-render.ts';
import { preserveSelectionById } from './switcher-selection.ts';
import { loadSwap } from './swap-loader.ts';
import type { SwapModule } from './swap-contract.ts';

const ASCII_MODE = process.env.CPD_ASCII === '1';
const SESSIONS_ROOT = process.env.HOME ? `${process.env.HOME}/.pi/agent/sessions` : '';
const ERROR_DISPLAY_MS = 4000;

const DIM = (text: string): string => foregroundAnsi(rgbColor(120, 120, 130), 'truecolor') + text;
const BOLD_RESET = '\x1b[0m';

class SwitcherComponent {
  private sessions: PiSession[] = [];
  private selectedId: string | null = null;
  private liveIds: Set<string> = new Set();
  private pendingFocusId: string | null = null;
  private errorMessage: string | null = null;
  private errorTimer: NodeJS.Timeout | null = null;
  private dashboardRunning = true;

  private readonly swap: SwapModule;

  constructor(swap: SwapModule) {
    this.swap = swap;
  }

  async refresh(): Promise<void> {
    try {
      this.dashboardRunning = await this.swap.isDashboardRunning();
    } catch {
      this.dashboardRunning = false;
    }

    const sessions = await listSessions(SESSIONS_ROOT || undefined);
    this.sessions = sessions;
    this.selectedId = preserveSelectionById(
      this.selectedId,
      sessions.map((s) => s.id),
    );

    try {
      this.liveIds = await this.swap.liveSessionIds();
    } catch {
      this.liveIds = new Set();
    }
  }

  moveSelection(delta: 1 | -1): void {
    if (this.sessions.length === 0) return;
    const ids = this.sessions.map((s) => s.id);
    const currentIndex = this.selectedId ? ids.indexOf(this.selectedId) : -1;
    const baseIndex = currentIndex === -1 ? 0 : currentIndex;
    const nextIndex = (baseIndex + delta + ids.length) % ids.length;
    this.selectedId = ids[nextIndex]!;
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
    });
    return lines;
  }
}

class SwitcherTextComponent implements Pick<Text, 'render' | 'invalidate'> {
  private readonly switcher: SwitcherComponent;

  constructor(switcher: SwitcherComponent) {
    this.switcher = switcher;
  }

  render(width: number): string[] {
    return this.switcher.render(width);
  }
  invalidate(): void {
    // no cached state to invalidate
  }
}

async function main(): Promise<void> {
  const swap = await loadSwap();
  const switcher = new SwitcherComponent(swap);
  await switcher.refresh();

  const terminal = new ProcessTerminal();
  const ui = new TuiAltScreen(terminal, false);
  const component = new SwitcherTextComponent(switcher);
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

  process.stdin.on('data', (data: Buffer) => {
    const key = data.toString('utf8');
    if (key === 'q' || key === '\u0003') {
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
    if (key === '\r' || key === '\n') {
      void switcher.focusSelected().then(() => ui.requestRender());
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
