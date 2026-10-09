import { readdirSync, statSync, openSync, closeSync, readSync, existsSync, watch } from 'node:fs';
import type { FSWatcher } from 'node:fs';

export interface PiSession {
  id: string;
  file: string;
  cwd: string;
  label: string;
  created: Date;
  updated: Date;
  /** Absolute path to the parent session file (pi's native `parentSession`
   * header field), or null when this session has no parent / was never
   * forked. Points OUTSIDE this file -- the cross-session lineage edge. */
  parentPath: string | null;
}

const HEADER_READ_SIZE = 4096;
const TAIL_READ_SIZE = 16384;
const LABEL_MAX_LEN = 80;

// Matches "<iso-ish-timestamp>_<uuid>.jsonl" where the timestamp has ':' replaced with '-'
// e.g. 2026-01-02T03-04-05.000Z_abc-123.jsonl
const FILENAME_RE = /^(.+)_(.+)\.jsonl$/;

function parseFilename(name: string): { id: string; created: Date } | null {
  const m = FILENAME_RE.exec(name);
  if (!m) return null;
  const [, tsRaw, id] = m;
  if (!id) return null;
  // Reconstruct ISO: the only ':' replaced are in the time portion, e.g.
  // 2026-01-02T03-04-05.000Z -> 2026-01-02T03:04:05.000Z
  const isoMatch = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})[.-](\d+)Z$/.exec(tsRaw);
  let created: Date;
  if (isoMatch) {
    const [, datePart, hh, mm, ss, ms] = isoMatch;
    const iso = `${datePart}T${hh}:${mm}:${ss}.${ms}Z`;
    created = new Date(iso);
  } else {
    created = new Date(tsRaw);
  }
  if (isNaN(created.getTime())) return null;
  return { id, created };
}

function readBoundedHead(file: string, size: number): string {
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(size);
    const bytesRead = readSync(fd, buf, 0, size, 0);
    return buf.toString('utf8', 0, bytesRead);
  } finally {
    closeSync(fd);
  }
}

function readBoundedTail(file: string, size: number, fileSize: number): string {
  const fd = openSync(file, 'r');
  try {
    const start = Math.max(0, fileSize - size);
    const len = fileSize - start;
    if (len <= 0) return '';
    const buf = Buffer.alloc(len);
    const bytesRead = readSync(fd, buf, 0, len, start);
    return buf.toString('utf8', 0, bytesRead);
  } finally {
    closeSync(fd);
  }
}

function truncateLabel(s: string): string {
  const oneLine = s.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= LABEL_MAX_LEN) return oneLine;
  return oneLine.slice(0, LABEL_MAX_LEN - 1) + '…';
}

function extractHeaderCwd(headText: string): string | null {
  const firstLine = firstHeaderLine(headText);
  if (!firstLine) return null;
  try {
    const parsed = JSON.parse(firstLine);
    if (parsed && typeof parsed.cwd === 'string' && parsed.cwd.length > 0) {
      return parsed.cwd;
    }
    return null;
  } catch {
    return null;
  }
}

function firstHeaderLine(headText: string): string | null {
  const firstNewline = headText.indexOf('\n');
  const firstLine = firstNewline === -1 ? headText : headText.slice(0, firstNewline);
  return firstLine.trim() ? firstLine : null;
}

/** Read the header's `parentSession` (pi's native cross-session lineage
 * edge, an absolute path to the parent .jsonl), or null when absent. */
function extractHeaderParentSession(headText: string): string | null {
  const firstLine = firstHeaderLine(headText);
  if (!firstLine) return null;
  try {
    const parsed = JSON.parse(firstLine);
    if (parsed && typeof parsed.parentSession === 'string' && parsed.parentSession.length > 0) {
      return parsed.parentSession;
    }
    return null;
  } catch {
    return null;
  }
}

/** Find the latest session_info.name by scanning complete JSON lines in a text blob. */
function findLatestSessionInfoName(text: string): string | null {
  const lines = text.split('\n');
  let latest: { name: string; ts: number } | null = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: any;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (obj && obj.type === 'session_info' && typeof obj.name === 'string' && obj.name.length > 0) {
      const ts = typeof obj.timestamp === 'string' ? Date.parse(obj.timestamp) : 0;
      if (!latest || ts >= latest.ts) {
        latest = { name: obj.name, ts: ts || 0 };
      }
    }
  }
  return latest ? latest.name : null;
}

/** Extract the text from a message content field, which may be a plain string
 * or an array of content parts (e.g. [{ type: 'text', text: '...' }, ...]). */
function extractMessageText(content: unknown): string | null {
  if (typeof content === 'string') {
    return content.length > 0 ? content : null;
  }
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const part of content) {
      if (part && typeof part === 'object' && typeof (part as any).text === 'string') {
        parts.push((part as any).text);
      }
    }
    const joined = parts.join(' ').trim();
    return joined.length > 0 ? joined : null;
  }
  return null;
}

/** Find the first user message text by scanning forward, stopping at first match. */
function findFirstUserMessage(text: string): string | null {
  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: any;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (obj && obj.type === 'message' && obj.message && obj.message.role === 'user') {
      const text = extractMessageText(obj.message.content);
      if (text) return text;
    }
  }
  return null;
}

function resolveLabel(file: string, fileSize: number, cwd: string): string {
  // Tier 2b: tail read for latest session_info.name (rename-aware, bounded).
  if (fileSize > 0) {
    const tailText = readBoundedTail(file, TAIL_READ_SIZE, fileSize);
    const name = findLatestSessionInfoName(tailText);
    if (name) return truncateLabel(name);

    // Tier 2c: forward bounded read for first user message, early-exit.
    const headText = readBoundedHead(file, HEADER_READ_SIZE);
    const firstMsg = findFirstUserMessage(headText);
    if (firstMsg) return truncateLabel(firstMsg);
  }

  // Tier 3: cwd basename, preferring '~' for the home directory and a short
  // relative path when the basename alone would be a weak/ambiguous label.
  const home = process.env.HOME;
  if (home && cwd === home) return '~';
  const base = cwd.split(/[/\\]/).filter(Boolean).pop() ?? cwd;
  if (home && cwd.startsWith(`${home}/`)) {
    const rel = cwd.slice(home.length + 1);
    return truncateLabel(`~/${rel}`);
  }
  return truncateLabel(base);
}

function listJsonlFiles(root: string): string[] {
  const files: string[] = [];
  let subdirs: string[];
  try {
    subdirs = readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return files;
  }
  for (const sub of subdirs) {
    const subPath = `${root}/${sub}`;
    let entries: string[];
    try {
      entries = readdirSync(subPath, { withFileTypes: true })
        .filter((d) => d.isFile() && d.name.endsWith('.jsonl'))
        .map((d) => `${subPath}/${d.name}`);
    } catch {
      continue;
    }
    files.push(...entries);
  }
  return files;
}

export async function listSessions(root?: string): Promise<PiSession[]> {
  const sessionsRoot = root ?? defaultSessionsRoot();
  if (!existsSync(sessionsRoot)) return [];

  const files = listJsonlFiles(sessionsRoot);
  const results: PiSession[] = [];

  for (const file of files) {
    try {
      const name = file.split('/').pop()!;
      const parsed = parseFilename(name);
      if (!parsed) continue;

      const stats = statSync(file);
      if (stats.size === 0) continue;

      const headText = readBoundedHead(file, HEADER_READ_SIZE);
      const cwd = extractHeaderCwd(headText);
      if (!cwd) continue;
      const parentPath = extractHeaderParentSession(headText);

      const label = resolveLabel(file, stats.size, cwd);

      results.push({
        id: parsed.id,
        file,
        cwd,
        label,
        created: parsed.created,
        updated: stats.mtime,
        parentPath,
      });
    } catch {
      // Skip any entry that errors (disappeared mid-scan, permission issue, etc.)
      continue;
    }
  }

  results.sort((a, b) => b.updated.getTime() - a.updated.getTime());
  return results;
}

function defaultSessionsRoot(): string {
  const home = process.env.HOME ?? '';
  return `${home}/.pi/agent/sessions`;
}

const DEBOUNCE_MS = 250;
const BACKSTOP_POLL_MS = 30000;

export function watchSessions(root: string, onChange: () => void): { close(): void } {
  let debounceTimer: NodeJS.Timeout | null = null;
  let fsWatcher: FSWatcher | null = null;

  const fire = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      onChange();
    }, DEBOUNCE_MS);
  };

  try {
    fsWatcher = watch(root, { recursive: true }, () => {
      fire();
    });
  } catch {
    fsWatcher = null;
  }

  const pollTimer = setInterval(() => {
    fire();
  }, BACKSTOP_POLL_MS);

  return {
    close() {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      clearInterval(pollTimer);
      if (fsWatcher) {
        fsWatcher.close();
        fsWatcher = null;
      }
    },
  };
}
