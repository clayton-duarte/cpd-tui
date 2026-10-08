#!/usr/bin/env node
import { listSessions } from '../src/sessions.ts';
import { listPanes, getCenterPane, focusSession, DashboardNotRunningError } from '../src/swap.ts';

function printPanes(panes: Awaited<ReturnType<typeof listPanes>>) {
  for (const p of panes) {
    console.log(
      `${p.paneId}\tkind=${p.kind ?? '-'}\tsession=${p.sessionId ?? '-'}\twindow=${p.window}\tsize=${p.width}x${p.height}\tpid=${p.pid}`,
    );
  }
}

async function main() {
  const [cmd, arg] = process.argv.slice(2);

  if (cmd === 'list') {
    const panes = await listPanes();
    printPanes(panes);
    return;
  }

  if (cmd === 'center') {
    const center = await getCenterPane();
    printPanes([center]);
    return;
  }

  if (cmd === 'focus') {
    if (!arg) {
      console.error('usage: cpd-swap focus <session-id>');
      process.exit(1);
    }
    const sessions = await listSessions();
    const session = sessions.find((s) => s.id === arg);
    if (!session) {
      console.error(`no session found with id ${arg}`);
      process.exit(1);
    }
    await focusSession(session);
    const center = await getCenterPane();
    printPanes([center]);
    return;
  }

  console.error('usage: cpd-swap <list|focus <session-id>|center>');
  process.exit(1);
}

main().catch((err) => {
  if (err instanceof DashboardNotRunningError) {
    console.error(err.message);
    process.exit(2);
  }
  console.error(err);
  process.exit(1);
});
