import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { closeSync, openSync, existsSync } from 'node:fs';
const db = resolve('prisma/plotstar-test.db');
if (!existsSync(db)) closeSync(openSync(db, 'a'));
const init = spawnSync(
  process.execPath,
  ['node_modules/prisma/build/index.js', 'db', 'push', '--skip-generate'],
  { stdio: 'inherit', env: process.env },
);
if (init.status !== 0) process.exit(init.status || 1);
const child = spawn(
  process.execPath,
  ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '3100'],
  { stdio: 'inherit', env: process.env },
);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    child.kill();
    process.exit(0);
  });
child.on('exit', (code) => process.exit(code || 0));
