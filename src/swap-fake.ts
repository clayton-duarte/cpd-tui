import type { PiSession } from './sessions.ts';
import type { CpdPane, SwapModule } from './swap-contract.ts';

/**
 * Fake implementation of the T4 swap contract, used for development and tests
 * behind CPD_FAKE_SWAP=1 until src/swap.ts exists for real.
 */
export function createFakeSwap(): SwapModule & { focusCalls: PiSession[] } {
  const focusCalls: PiSession[] = [];

  const fakePanes: CpdPane[] = [
    {
      paneId: '%0',
      kind: 'switcher',
      sessionId: null,
      window: 'dash',
      width: 22,
      height: 40,
      pid: 1001,
    },
    {
      paneId: '%1',
      kind: 'center',
      sessionId: null,
      window: 'dash',
      width: 48,
      height: 40,
      pid: 1002,
    },
    {
      paneId: '%2',
      kind: 'slot',
      sessionId: null,
      window: 'dash',
      width: 30,
      height: 40,
      pid: 1003,
    },
  ];

  return {
    focusCalls,
    async listPanes(): Promise<CpdPane[]> {
      return fakePanes;
    },
    async getCenterPane(): Promise<CpdPane> {
      return fakePanes[1]!;
    },
    async liveSessionIds(): Promise<Set<string>> {
      return new Set();
    },
    async focusSession(session: PiSession): Promise<void> {
      focusCalls.push(session);
    },
    async isDashboardRunning(): Promise<boolean> {
      return true;
    },
  };
}
