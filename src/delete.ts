import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';

export class LiveSessionDeleteError extends Error {
  constructor() {
    super('close it first');
    this.name = 'LiveSessionDeleteError';
  }
}

/** Pure guard: can this session be deleted right now? A live session (one
 * currently occupying a pane) must be refused — never kill pi for the user. */
export function assertDeletable(sessionId: string, liveIds: ReadonlySet<string>): void {
  if (liveIds.has(sessionId)) {
    throw new LiveSessionDeleteError();
  }
}

export interface TrashOptions {
  trashRoot: string; // e.g. ~/.cpd/trash
}

/** Moves a session's .jsonl file to a trash/backup dir instead of unlinking,
 * so a misfire is recoverable. This is the one and only place in the project
 * permitted to write to ~/.pi/ (the source file's directory tree) — it only
 * ever moves a file away from there, never writes into it. */
export function trashSessionFile(file: string, options: TrashOptions): string {
  if (!existsSync(options.trashRoot)) {
    mkdirSync(options.trashRoot, { recursive: true });
  }
  const base = file.split(/[/\\]/).pop()!;
  const dest = join(options.trashRoot, base);
  renameSync(file, dest);
  return dest;
}

export function defaultTrashRoot(): string {
  const home = process.env.HOME ?? '';
  return join(home, '.cpd', 'trash');
}

// Re-export for callers that want the dirname of a would-be trash file path.
export { dirname };
