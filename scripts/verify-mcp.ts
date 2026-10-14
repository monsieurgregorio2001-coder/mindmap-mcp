// Starts the real stdio MCP server in a temp database and lists its tools with an MCP client.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-verify-'));
const transport = new StdioClientTransport({
  command: 'npx',
  args: ['tsx', 'src/mcp/index.ts'],
  env: { ...process.env, MINDMAP_DB: path.join(tmp, 'verify.db') } as Record<string, string>,
});
const client = new Client({ name: 'verify', version: '1.0.0' });
await client.connect(transport);
const { tools } = await client.listTools();
console.log(`Server exposes ${tools.length} tools:`);
for (const t of tools) console.log(`  - ${t.name}`);
await client.close();
fs.rmSync(tmp, { recursive: true, force: true });
if (tools.length !== 12) process.exit(1);
