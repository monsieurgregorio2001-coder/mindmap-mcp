import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { defaultDbPath, openDb } from '../core/db.js';
import { Store } from '../core/store.js';
import { createMcpServer } from './server.js';

// stdout carries the MCP protocol; log only to stderr.
const store = new Store(openDb());
const server = createMcpServer(store);
await server.connect(new StdioServerTransport());
console.error(`living-mindmap MCP ready (db: ${defaultDbPath()})`);
