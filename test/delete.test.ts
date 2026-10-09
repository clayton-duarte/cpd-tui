import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertDeletable, LiveSessionDeleteError, trashSessionFile } from '../src/delete.ts';

describe('assertDeletable (live vs dormant guard)', () => {
  it('allows deleting a dormant session (not in liveIds)', () => {
    expect(() => assertDeletable('dormant-1', new Set(['live-1']))).not.toThrow();
  });

  it('refuses to delete a live session, with the exact "close it first" message', () => {
    expect(() => assertDeletable('live-1', new Set(['live-1']))).toThrow(LiveSessionDeleteError);
    try {
      assertDeletable('live-1', new Set(['live-1']));
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(LiveSessionDeleteError);
      expect((err as Error).message).toBe('close it first');
    }
  });
});

describe('trashSessionFile (move, never unlink)', () => {
  const roots: string[] = [];
  afterEach(() => {
    while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
  });

  it('moves the file into the trash root, leaving the original path gone', () => {
    const srcRoot = mkdtempSync(join(tmpdir(), 'cpd-tui-src-'));
    const trashRoot = mkdtempSync(join(tmpdir(), 'cpd-tui-trash-'));
    roots.push(srcRoot, trashRoot);

    const file = join(srcRoot, 'session-abc.jsonl');
    writeFileSync(file, 'hello');

    const dest = trashSessionFile(file, { trashRoot });

    expect(existsSync(file)).toBe(false);
    expect(existsSync(dest)).toBe(true);
    expect(readFileSync(dest, 'utf8')).toBe('hello');
    expect(dest).toBe(join(trashRoot, 'session-abc.jsonl'));
  });

  it('creates the trash root if it does not exist yet', () => {
    const srcRoot = mkdtempSync(join(tmpdir(), 'cpd-tui-src2-'));
    const trashRoot = join(mkdtempSync(join(tmpdir(), 'cpd-tui-trash2-')), 'nested', 'trash');
    roots.push(srcRoot, trashRoot);

    const file = join(srcRoot, 'session-def.jsonl');
    writeFileSync(file, 'world');

    const dest = trashSessionFile(file, { trashRoot });
    expect(existsSync(dest)).toBe(true);
  });
});
