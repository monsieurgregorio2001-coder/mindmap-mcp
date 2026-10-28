// Runs the hub's house-sync against this room. HOUSE_DIR is a checkout of the public hub repo.
//   node scripts/house.mjs            inject the pinned partials into index.html
//   node scripts/house.mjs --check    fail if index.html drifts from the pinned house
//   node scripts/house.mjs --404      write dist/404.html
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const dir = process.env.HOUSE_DIR;
if (!dir) {
  console.error('Set HOUSE_DIR to a checkout of the hub repo.');
  process.exit(1);
}
const sync = path.resolve(dir, 'house/2.0.1/tools/house-sync.mjs');
const flag = process.argv[2];
const args =
  flag === '--404'
    ? ['--404', 'dist/404.html', '--room', 'mindmap-mcp']
    : [...(flag ? [flag] : []), '--room', 'mindmap-mcp', 'index.html'];
const r = spawnSync(process.execPath, [sync, ...args], { stdio: 'inherit' });
process.exit(r.status ?? 1);
