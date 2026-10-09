import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';
import type { PiSession } from './sessions.ts';

/** Every input mode the switcher can be in. Declared HERE because switcher.ts
 * already imports this module (the reverse would be a cycle), and switcher.ts
 * constrains its Mode union to this type -- so adding a mode there without
 * teaching the renderer about it is a compile error, not a silent default. */
export type SwitcherModeKind = 'list' | 'create-cwd' | 'confirm-delete' | 'confirm-delete-live';

export interface RenderOptions {
  width: number;
  ascii: boolean;
  selectedId: string | null;
  liveIds: ReadonlySet<string>;
  pendingFocusId: string | null;
  errorMessage: string | null;
  dashboardRunning: boolean;
  /** Which input mode is active. The bottom hint line only shows the
   * list-mode shortcuts when this is 'list' (the default) — any other mode
   * is expected to render its own hint line instead, so we don't double up. */
  mode?: SwitcherModeKind;
}

const ARROWS = { unicode: '\u2191\u2193', ascii: 'up/down' };
const DOT = { unicode: '\u00b7', ascii: '-' };

/** The persistent bottom-of-pane shortcut hint shown in normal list mode. */
export function renderListHint(width: number, ascii: boolean): string {
  const sep = ` ${glyph(DOT, ascii)} `;
  const hint = [
    `${glyph(ARROWS, ascii)} move`,
    'enter open',
    'n new',
    'd delete',
    'r refresh',
  ].join(sep);
  return clampLine(hint, width, ascii);
}

const LIVE_GLYPH = { unicode: '●', ascii: '*' };
const DORMANT_GLYPH = { unicode: '○', ascii: 'o' };
const SELECTED_MARKER = { unicode: '›', ascii: '>' };
const ELLIPSIS = { unicode: '\u2026', ascii: '...' };

function glyph(pair: { unicode: string; ascii: string }, ascii: boolean): string {
  return ascii ? pair.ascii : pair.unicode;
}

/** Relative time like "2m", "3h", "yesterday", "5d". */
export function relativeTime(from: Date, now: Date = new Date()): string {
  const diffMs = now.getTime() - from.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `${Math.max(0, diffSec)}s`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay === 1) return 'yesterday';
  return `${diffDay}d`;
}

/** Render the full switcher pane body (all rows) for a given width. Never exceeds width. */
export function renderSwitcher(sessions: readonly PiSession[], options: RenderOptions): string[] {
  const { width, ascii } = options;
  const mode = options.mode ?? 'list';
  const lines: string[] = [];

  lines.push(clampLine('cpd sessions', width, ascii));
  lines.push('');

  if (!options.dashboardRunning) {
    lines.push(clampLine('dashboard not running', width, ascii));
    if (mode === 'list') lines.push(renderListHint(width, ascii));
    return lines;
  }

  if (sessions.length === 0) {
    lines.push(clampLine('no pi sessions yet', width, ascii));
    if (mode === 'list') lines.push(renderListHint(width, ascii));
    return lines;
  }

  const now = new Date();
  for (const session of sessions) {
    lines.push(clampLine(renderRow(session, options, now), width, ascii));
  }

  lines.push('');
  const liveCount = sessions.filter((s) => options.liveIds.has(s.id)).length;
  const sep = ascii ? '-' : '\u00b7';
  lines.push(clampLine(`${sessions.length} sessions ${sep} ${liveCount} live`, width, ascii));

  if (options.errorMessage) {
    lines.push(clampLine(options.errorMessage, width, ascii));
  }

  // The hint line is pinned LAST and only appears in list mode; prompt modes
  // (create-cwd, confirm-delete) render their own single hint line instead,
  // appended by switcher.ts's render() after this returns — never both.
  if (mode === 'list') {
    lines.push(renderListHint(width, ascii));
  }

  return lines;
}

function clampLine(line: string, width: number, ascii: boolean): string {
  // Defensive: render() in pi-tui never throws on overflow either, but keep
  // our own output honest so tests can assert width directly.
  if (visibleWidth(line) <= width) return line;
  return truncateToWidth(line, width, glyph(ELLIPSIS, ascii));
}

function renderRow(session: PiSession, options: RenderOptions, now: Date): string {
  const { width, ascii, selectedId, liveIds, pendingFocusId } = options;
  const isSelected = session.id === selectedId;
  const isLive = liveIds.has(session.id);
  const marker = isSelected ? glyph(SELECTED_MARKER, ascii) : ' ';
  const status = isLive ? glyph(LIVE_GLYPH, ascii) : glyph(DORMANT_GLYPH, ascii);
  const pending = pendingFocusId === session.id ? ` ${glyph(ELLIPSIS, ascii)}` : '';

  const prefix = `${marker} ${status} `;
  const prefixWidth = visibleWidth(prefix);
  const suffixWidth = visibleWidth(pending);
  const availableForLabelAndTime = Math.max(0, width - prefixWidth - suffixWidth);

  if (availableForLabelAndTime <= 0) {
    return truncateToWidth(prefix, width, glyph(ELLIPSIS, ascii));
  }

  const time = relativeTime(session.updated, now);
  const withTime = `${session.label} ${time}`;
  let body: string;
  if (visibleWidth(withTime) <= availableForLabelAndTime) {
    body = withTime;
  } else {
    body = session.label;
  }
  const truncatedBody = truncateToWidth(body, availableForLabelAndTime, glyph(ELLIPSIS, ascii));
  return `${prefix}${truncatedBody}${pending}`;
}
