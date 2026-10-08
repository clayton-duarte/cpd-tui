import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFileCb);

/** Resolves the tmux invocation args to reliably target the cpd server,
 * whether we're running from inside one of its panes (use $TMUX's socket
 * path, exact and immune to TMUX_TMPDIR differences) or from outside it
 * (fall back to the well-known `-L cpd` socket name). */
export function tmuxBaseArgs(): string[] {
  const tmuxEnv = process.env.TMUX;
  if (tmuxEnv) {
    const sock = tmuxEnv.split(',')[0];
    if (sock) return ['-S', sock];
  }
  return ['-L', 'cpd'];
}

/** Runs a tmux command against the cpd server. Never touches the user's
 * default tmux server: always goes through tmuxBaseArgs(). */
export async function tmux(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('tmux', [...tmuxBaseArgs(), ...args]);
  return stdout;
}

/** Same as tmux(), but resolves to null instead of throwing on failure
 * (e.g. "can't find session"), for existence checks. */
export async function tmuxOk(args: string[]): Promise<boolean> {
  try {
    await tmux(args);
    return true;
  } catch {
    return false;
  }
}
