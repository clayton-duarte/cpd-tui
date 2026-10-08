import type { PiSession } from './sessions.ts';

export interface CpdPane {
  paneId: string;
  kind: 'switcher' | 'center' | 'slot' | 'parked' | null;
  sessionId: string | null;
  window: string;
  width: number;
  height: number;
  pid: number;
}

export interface SwapModule {
  listPanes(): Promise<CpdPane[]>;
  getCenterPane(): Promise<CpdPane>;
  liveSessionIds(): Promise<Set<string>>;
  focusSession(session: PiSession): Promise<void>;
  isDashboardRunning(): Promise<boolean>;
}
