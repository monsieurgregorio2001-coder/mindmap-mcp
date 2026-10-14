// Measures median round-trip latency per MCP tool call over the real stdio transport.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { openDb } from '../src/core/db.js';
import { Store } from '../src/core/store.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-bench-'));
const dbFile = path.join(tmp, 'bench.db');
const store = new Store(openDb(dbFile));
for (let i = 0; i < 10; i++) store.createMap({ title: `Bench Round ${i}` });
const client = new Client({ name: 'bench', version: '1.0.0' });
await client.connect(
  new StdioClientTransport({
    command: 'npx',
    args: ['tsx', 'src/mcp/index.ts'],
    env: { ...process.env, MINDMAP_DB: dbFile } as Record<string, string>,
  }),
);
const call = async (name: string, args: Record<string, unknown> = {}) => {
  const t0 = performance.now();
  const r = await client.callTool({ name, arguments: args });
  const ms = performance.now() - t0;
  return { ms, data: JSON.parse((r.content as { text: string }[])[0].text), isError: !!r.isError };
};
const times: number[] = [];
let failures = 0;
const timed = async (name: string, args: Record<string, unknown> = {}) => {
  const r = await call(name, args);
  times.push(r.ms);
  if (r.isError) failures++;
  return r.data;
};

// Scripted task: build a 10-node map, then read it back several ways. Repeated for 10 rounds.
const ROUNDS = 10;
let calls = 0;
await call('list_maps'); // warm up
times.length = 0;
for (let round = 0; round < ROUNDS; round++) {
  const mapName = `Bench Round ${round}`;
  await timed('list_maps');
  const first = await timed('create_node', { map: mapName, title: 'Topic Alpha' });
  const rootId: string | undefined = first?.node?.id;
  if (!rootId) {
    failures++;
    continue;
  }
  const words = ['Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India', 'Juliet'];
  for (const w of words) await timed('create_node', { map: mapName, title: `Concept ${w}`, parent_id: rootId });
  await timed('get_map', { map: mapName });
  await timed('search_nodes', { query: 'foxtrot', map: mapName });
  await timed('get_node', { node_id: rootId });
  await timed('get_branch', { node_id: rootId });
  await timed('get_ai_context', { root_id: rootId });
}
calls = times.length;
times.sort((a, b) => a - b);
const pct = (p: number) => times[Math.min(times.length - 1, Math.floor(times.length * p))].toFixed(1);
console.log(`calls=${calls} failures=${failures} median=${pct(0.5)}ms p95=${pct(0.95)}ms`);
await client.close();
fs.rmSync(tmp, { recursive: true, force: true });
if (failures) process.exit(1);
