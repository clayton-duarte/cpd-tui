import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Build a temp sessions root fixture. Returns the root path. */
export function makeFixtureRoot(): string {
  return mkdtempSync(join(tmpdir(), 'cpd-tui-sessions-'));
}

export function encodeDir(cwd: string): string {
  const safe = `--${cwd.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`;
  return safe;
}

export interface WriteSessionOpts {
  root: string;
  cwd: string;
  id?: string;
  createdIso?: string; // ISO timestamp used in filename (colons replaced with -)
  header?: Record<string, unknown>;
  lines?: unknown[]; // additional JSONL lines after header
  dirName?: string; // override directory name (for junk/collision tests)
  fileName?: string; // override full file name (for malformed filename tests)
  rawContent?: string; // if set, write this raw content instead of header+lines
}

let counter = 0;

export function writeSessionFixture(opts: WriteSessionOpts): string {
  const id = opts.id ?? `00000000-0000-0000-0000-${String(counter++).padStart(12, '0')}`;
  const createdIso = opts.createdIso ?? new Date().toISOString();
  const dirName = opts.dirName ?? encodeDir(opts.cwd);
  const dir = join(opts.root, dirName);
  mkdirSync(dir, { recursive: true });

  const fileSafeTs = createdIso.replace(/:/g, '-');
  const fileName = opts.fileName ?? `${fileSafeTs}_${id}.jsonl`;
  const file = join(dir, fileName);

  if (opts.rawContent !== undefined) {
    writeFileSync(file, opts.rawContent);
    return file;
  }

  const header = opts.header ?? {
    type: 'session',
    version: 3,
    id,
    timestamp: createdIso,
    cwd: opts.cwd,
  };

  const lines = [header, ...(opts.lines ?? [])];
  writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return file;
}

export function userMessage(text: string, id = 'u1') {
  return {
    type: 'message',
    id,
    parentId: null,
    timestamp: new Date().toISOString(),
    message: { role: 'user', content: text },
  };
}

export function sessionInfoName(name: string, id = 'si1', timestamp?: string) {
  return {
    type: 'session_info',
    id,
    parentId: null,
    timestamp: timestamp ?? new Date().toISOString(),
    name,
  };
}
