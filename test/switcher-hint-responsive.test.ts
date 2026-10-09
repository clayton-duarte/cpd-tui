import { describe, it, expect } from 'vitest';
import { visibleWidth } from '@earendil-works/pi-tui';
import { renderListHint } from '../src/switcher-render.ts';

describe('renderListHint responsive wrapping (T-HINT2)', () => {
  it('[A] width=60 -> single line, exactly today\'s full output (regression guard)', () => {
    const lines = renderListHint(60, false);
    expect(lines).toEqual([
      '\u2191\u2193 move \u00b7 enter open \u00b7 n new \u00b7 f fork \u00b7 d delete \u00b7 r refresh',
    ]);
  });

  it('[B] width=44 (THE REAL PANE WIDTH) -> every key present, no ellipsis', () => {
    const lines = renderListHint(44, false);
    const joined = lines.join(' ');
    for (const token of ['enter', 'n', 'f', 'd', 'r']) {
      expect(joined).toContain(token);
    }
    for (const line of lines) {
      expect(line).not.toContain('\u2026');
    }
  });

  it('[C] no returned line exceeds the requested width', () => {
    for (const width of [60, 44, 30, 20, 10]) {
      const lines = renderListHint(width, false);
      for (const line of lines) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
    }
  });

  it('[D] very narrow (width=20) -> wraps cleanly, no ellipsis, no overflow', () => {
    const lines = renderListHint(20, false);
    for (const line of lines) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(20);
      expect(line).not.toContain('\u2026');
    }
  });

  it('[D2] absurdly narrow (width=8) -> falls back to bare key tokens, no overflow', () => {
    const lines = renderListHint(8, false);
    for (const line of lines) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(8);
      expect(line).not.toContain('\u2026');
    }
    const joined = lines.join(' ');
    expect(joined).not.toContain('delete');
    expect(joined).not.toContain('refresh');
    for (const token of ['enter', 'n', 'f', 'd', 'r']) {
      expect(joined).toContain(token);
    }
    // The bare tier must PACK tokens onto shared lines while they fit, not
    // degrade to one-token-per-line (that is the last-resort tier, and at
    // width=8 it is not yet warranted). Without this, dropping the bare
    // wrapSegments tier entirely still passes.
    expect(lines).toEqual(['\u2191\u2193', 'enter', 'n \u00b7 f', 'd \u00b7 r']);
  });

  it('[E] ascii mode -> no non-ASCII characters anywhere in the output', () => {
    for (const width of [60, 44, 20, 10]) {
      const lines = renderListHint(width, true);
      for (const line of lines) {
        // eslint-disable-next-line no-control-regex
        expect(/^[\x00-\x7F]*$/.test(line)).toBe(true);
      }
    }
  });
});
