// The demo build: check the house pin, build with Vite, write the room's 404 through house-sync.
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: false });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
const node = process.execPath;
run(node, [path.resolve('scripts/house.mjs'), '--check']);
run(node, [path.resolve('node_modules/vite/bin/vite.js'), 'build']);
run(node, [path.resolve('scripts/house.mjs'), '--404']);
