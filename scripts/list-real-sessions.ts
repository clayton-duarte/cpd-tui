import { listSessions } from '../src/sessions.ts';

const root = `${process.env.HOME}/.pi/agent/sessions`;
const start = Date.now();
const sessions = await listSessions(root);
const elapsed = Date.now() - start;

console.log(`count: ${sessions.length}  elapsed_ms: ${elapsed}`);
console.log('id'.padEnd(38), 'label'.padEnd(30), 'cwd'.padEnd(45), 'updated');
for (const s of sessions) {
  console.log(
    s.id.padEnd(38),
    s.label.slice(0, 28).padEnd(30),
    s.cwd.slice(0, 43).padEnd(45),
    s.updated.toISOString()
  );
}
