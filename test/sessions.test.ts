import { describe, it, expect, vi, afterEach } from 'vitest';
import { rmSync, mkdirSync, writeFileSync, statSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { listSessions, watchSessions } from '../src/sessions.ts';
import {
  makeFixtureRoot,
  writeSessionFixture,
  userMessage,
  userMessageParts,
  systemMessage,
  sessionInfoName,
} from './fixtures.ts';

const roots: string[] = [];
function root(): string {
  const r = makeFixtureRoot();
  roots.push(r);
  return r;
}

afterEach(() => {
  while (roots.length) {
    const r = roots.pop()!;
    rmSync(r, { recursive: true, force: true });
  }
});

describe('listSessions - filename parsing', () => {
  it('extracts id and created from the filename', async () => {
    const r = root();
    const file = writeSessionFixture({
      root: r,
      cwd: '/Users/x/projects/foo',
      id: 'abc-123',
      createdIso: '2026-01-02T03:04:05.000Z',
    });
    const sessions = await listSessions(r);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe('abc-123');
    expect(sessions[0].created.toISOString()).toBe('2026-01-02T03:04:05.000Z');
    expect(sessions[0].file).toBe(file);
  });

  it('skips a malformed filename', async () => {
    const r = root();
    writeSessionFixture({ root: r, cwd: '/Users/x', fileName: 'not-a-valid-name.jsonl' });
    const sessions = await listSessions(r);
    expect(sessions).toHaveLength(0);
  });
});

describe('listSessions - cwd from header, never from dir name', () => {
  it('reads cwd from the header even when it contains a dash', async () => {
    const r = root();
    // cwd contains a literal '-' which collides in the lossy dir-name encoding
    writeSessionFixture({ root: r, cwd: '/Users/x/projects/cpd-tui', id: 's1' });
    const sessions = await listSessions(r);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].cwd).toBe('/Users/x/projects/cpd-tui');
  });
});

describe('listSessions - label resolution order', () => {
  it('prefers session_info name over first user message', async () => {
    const r = root();
    writeSessionFixture({
      root: r,
      cwd: '/Users/x/foo',
      lines: [userMessage('hello there'), sessionInfoName('my-name')],
    });
    const sessions = await listSessions(r);
    expect(sessions[0].label).toBe('my-name');
  });

  it('falls back to first user message when no session_info name', async () => {
    const r = root();
    writeSessionFixture({
      root: r,
      cwd: '/Users/x/foo',
      lines: [userMessage('hello there')],
    });
    const sessions = await listSessions(r);
    expect(sessions[0].label).toBe('hello there');
  });

  it('falls back to cwd basename when no name or user message', async () => {
    const r = root();
    writeSessionFixture({ root: r, cwd: '/Users/x/my-project', lines: [] });
    const sessions = await listSessions(r);
    expect(sessions[0].label).toBe('my-project');
  });

  it('uses the LAST session_info name, not the first (rename)', async () => {
    const r = root();
    writeSessionFixture({
      root: r,
      cwd: '/Users/x/foo',
      lines: [
        sessionInfoName('first-name', 'si1', '2026-01-01T00:00:00.000Z'),
        sessionInfoName('second-name', 'si2', '2026-01-02T00:00:00.000Z'),
      ],
    });
    const sessions = await listSessions(r);
    expect(sessions[0].label).toBe('second-name');
  });

  it('extracts text when user message content is an array of parts (real on-disk shape)', async () => {
    const r = root();
    writeSessionFixture({
      root: r,
      cwd: '/Users/x/foo',
      lines: [userMessageParts('ping')],
    });
    const sessions = await listSessions(r);
    expect(sessions[0].label).toBe('ping');
  });

  it('skips a leading system message and finds the first user message', async () => {
    const r = root();
    writeSessionFixture({
      root: r,
      cwd: '/Users/x/foo',
      lines: [systemMessage(''), userMessageParts('hello')],
    });
    const sessions = await listSessions(r);
    expect(sessions[0].label).toBe('hello');
  });
});

describe('listSessions - robustness', () => {
  it('skips an empty file', async () => {
    const r = root();
    writeSessionFixture({ root: r, cwd: '/x', rawContent: '' });
    const sessions = await listSessions(r);
    expect(sessions).toHaveLength(0);
  });

  it('skips a file with truncated/invalid JSON on line 1', async () => {
    const r = root();
    writeSessionFixture({ root: r, cwd: '/x', rawContent: '{"type":"session", "cwd":' });
    const sessions = await listSessions(r);
    expect(sessions).toHaveLength(0);
  });

  it('handles a header with no messages (label falls back to cwd basename)', async () => {
    const r = root();
    writeSessionFixture({ root: r, cwd: '/Users/x/bare-proj', lines: [] });
    const sessions = await listSessions(r);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].label).toBe('bare-proj');
  });

  it('ignores a non-.jsonl file present in a session dir', async () => {
    const r = root();
    writeSessionFixture({ root: r, cwd: '/Users/x/foo' });
    mkdirSync(join(r, '--Users-x-foo--'), { recursive: true });
    writeFileSync(join(r, '--Users-x-foo--', 'README.md'), 'not a session');
    const sessions = await listSessions(r);
    expect(sessions).toHaveLength(1);
  });

  it('returns empty array for an empty sessions root', async () => {
    const r = root();
    const sessions = await listSessions(r);
    expect(sessions).toEqual([]);
  });

  it('returns empty array for a non-existent root', async () => {
    const sessions = await listSessions('/nonexistent/path/does/not/exist');
    expect(sessions).toEqual([]);
  });
});

describe('listSessions - sorting', () => {
  it('sorts newest-updated first', async () => {
    const r = root();
    const f1 = writeSessionFixture({ root: r, cwd: '/Users/x/a', id: 's-old' });
    const f2 = writeSessionFixture({ root: r, cwd: '/Users/x/b', id: 's-new' });
    const old = new Date(Date.now() - 100000);
    const recent = new Date();
    const fs = await import('node:fs');
    fs.utimesSync(f1, old, old);
    fs.utimesSync(f2, recent, recent);
    const sessions = await listSessions(r);
    expect(sessions.map((s) => s.id)).toEqual(['s-new', 's-old']);
  });
});

describe('listSessions - bounded reads', () => {
  it('completes quickly even with a huge session file', async () => {
    const r = root();
    const bigBody = Array.from({ length: 50000 }, (_, i) =>
      JSON.stringify(userMessage(`msg number ${i} `.repeat(10), `u${i}`))
    ).join('\n');
    writeSessionFixture({
      root: r,
      cwd: '/Users/x/big',
      rawContent:
        JSON.stringify({
          type: 'session',
          version: 3,
          id: 'big1',
          timestamp: new Date().toISOString(),
          cwd: '/Users/x/big',
        }) +
        '\n' +
        bigBody +
        '\n',
    });
    const start = Date.now();
    const sessions = await listSessions(r);
    const elapsed = Date.now() - start;
    expect(sessions).toHaveLength(1);
    expect(elapsed).toBeLessThan(500);
  });
});

describe('watchSessions', () => {
  it('fires onChange on a file change', async () => {
    const r = root();
    writeSessionFixture({ root: r, cwd: '/Users/x/watched' });
    const onChange = vi.fn();
    const watcher = watchSessions(r, onChange);
    await new Promise((resolve) => setTimeout(resolve, 100));
    appendFileSync(join(r, '--Users-x-watched--', 'extra.txt'), 'change');
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(onChange).toHaveBeenCalled();
    watcher.close();
  });

  it('coalesces rapid changes into one debounced call', async () => {
    const r = root();
    writeSessionFixture({ root: r, cwd: '/Users/x/watched2' });
    const onChange = vi.fn();
    const watcher = watchSessions(r, onChange);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const target = join(r, '--Users-x-watched2--', 'extra.txt');
    for (let i = 0; i < 5; i++) {
      appendFileSync(target, `change${i}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(onChange.mock.calls.length).toBe(1);
    watcher.close();
  });

  it('close() stops further calls', async () => {
    const r = root();
    writeSessionFixture({ root: r, cwd: '/Users/x/watched3' });
    const onChange = vi.fn();
    const watcher = watchSessions(r, onChange);
    await new Promise((resolve) => setTimeout(resolve, 100));
    watcher.close();
    const callsBefore = onChange.mock.calls.length;
    appendFileSync(join(r, '--Users-x-watched3--', 'extra.txt'), 'change');
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(onChange.mock.calls.length).toBe(callsBefore);
  });
});
