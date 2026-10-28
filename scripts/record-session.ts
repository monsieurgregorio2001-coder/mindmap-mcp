// Records a SCRIPTED agent session against the real stdio MCP server and writes demo/session.json.
// The server runs on a temporary database behind a logging transport that sees every JSON-RPC frame.
// The agent's moves are written below. No model chooses them, and the file says so.
//   npm run record
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../src/core/db.js';
import { seedSpec } from '../src/core/seed.js';
import { SUPPORT_INBOX } from '../src/core/seed-spec.js';
import { Store } from '../src/core/store.js';
import { layoutTree } from '../src/shared/graph.js';

const CLIENT = { name: 'mindmap-demo-recorder', version: '1.0.0' };

/** Sits between the client and the real stdio transport and counts every frame in both directions. */
class LoggingTransport implements Transport {
  onclose?: () => void;
  onerror?: (e: Error) => void;
  onmessage?: (m: JSONRPCMessage) => void;
  frames = { sent: 0, received: 0 };
  constructor(private inner: Transport) {}
  async start() {
    this.inner.onmessage = (m) => {
      this.frames.received++;
      this.onmessage?.(m);
    };
    this.inner.onclose = () => this.onclose?.();
    this.inner.onerror = (e) => this.onerror?.(e);
    await this.inner.start();
  }
  async send(m: JSONRPCMessage) {
    this.frames.sent++;
    await this.inner.send(m);
  }
  close() {
    return this.inner.close();
  }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-record-'));
const dbFile = path.join(tmp, 'record.db');
const store = new Store(openDb(dbFile));
const mapId = seedSpec(store, SUPPORT_INBOX);
const initial = store.getGraph(mapId);
const byTitle = (t: string) => initial.nodes.find((n) => n.title === t)!.id;
const parentOf = new Map(initial.edges.map((e) => [e.target_node_id, e.source_node_id]));

const transport = new LoggingTransport(
  new StdioClientTransport({
    command: 'npx',
    args: ['tsx', 'src/mcp/index.ts'],
    env: { ...process.env, MINDMAP_DB: dbFile } as Record<string, string>,
  }),
);
const client = new Client(CLIENT);
await client.connect(transport);
const { tools } = await client.listTools();

interface Call {
  n: number;
  tool: string;
  note: string;
  args: Record<string, unknown>;
  is_error: boolean;
  result: Record<string, unknown>;
}
const calls: Call[] = [];
/** The only edit made to a recorded result: timestamps are removed. */
const stripTimes = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(stripTimes)
    : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.entries(v)
            .filter(([k]) => !k.endsWith('_at'))
            .map(([k, x]) => [k, stripTimes(x)]),
        )
      : v;
const call = async (tool: string, note: string, args: Record<string, unknown>) => {
  const r = await client.callTool({ name: tool, arguments: args });
  const result = stripTimes(JSON.parse((r.content as { text: string }[])[0].text)) as Record<string, unknown>;
  calls.push({ n: calls.length + 1, tool, note, args, is_error: !!r.isError, result });
  return result;
};

// The script. Every line is a decision made by whoever wrote this file.
const MAP = SUPPORT_INBOX.title;
await call('list_maps', 'Find out which maps exist.', {});
await call('get_map', 'Read the whole map before adding anything.', { map: MAP });
await call('search_nodes', 'Check whether review is already covered.', { query: 'review', map: MAP });
await call('get_node', 'Look at the drafting branch up close.', { node_id: byTitle('Drafting replies') });
await call('create_node', 'Drafts need a place to wait for a person.', {
  parent_id: byTitle('Drafting replies'),
  title: 'Reply approval queue',
  summary: 'Drafts wait here until a person approves or edits them.',
  relationship: 'leads to',
});
await call('create_node', 'Escalation needs a handover note.', {
  parent_id: byTitle('Escalation to a person'),
  title: 'Handoff summary',
  summary: 'What the person sees when the assistant steps back.',
  questions: ['Which facts must always be included?'],
  relationship: 'produces',
});
await call('create_node', 'Add the help center under the knowledge base, with the British spelling.', {
  parent_id: byTitle('Knowledge base'),
  title: 'Help-centre articles',
  summary: 'Public pages the assistant can cite.',
});
await call('update_node', 'The guard refused. Enrich the node that exists instead.', {
  node_id: byTitle('Help-center articles'),
  append_notes: 'Match both spellings, center and centre, when looking articles up.',
  add_tags: ['checked'],
});
await call('create_node', 'Quality needs one number a reviewer can act on.', {
  parent_id: byTitle('Measuring quality'),
  title: 'Draft acceptance rate',
  summary: 'Share of drafts a reviewer sends with no edits.',
  relationship: 'tracked by',
});
await call('create_edge', 'Feedback should tune the tone guide.', {
  source_node_id: byTitle('Reviewer feedback'),
  target_node_id: byTitle('Tone and style guide'),
  label: 'tunes',
});
await client.close();

// Snapshot of the final database, for the replay's end state. Ids are the real ones from the run.
const final = store.getGraph(mapId);
const stepOfNode = new Map<string, number>();
for (const c of calls) {
  const node = (c.result.node as { id?: string } | undefined)?.id;
  if (c.tool === 'create_node' && !c.is_error && node) stepOfNode.set(node, c.n);
}
const stepOfEdge = new Map<string, number>();
const touched: Record<string, number> = {};
for (const c of calls) {
  const edge = (c.result.edge as { id?: string } | undefined)?.id;
  if (c.tool === 'create_edge' && edge) stepOfEdge.set(edge, c.n);
  if (c.tool === 'update_node' && !c.is_error) touched[c.args.node_id as string] = c.n;
}
const refused = calls.find((c) => c.tool === 'create_node' && c.is_error);
if (!refused) throw new Error('The script expected the guard to refuse one node.');

// Precomputed positions. The refused node gets a reserved slot so the graph does not reflow when it is replayed.
const GHOST = 'ghost';
const layoutNodes = [
  ...final.nodes.map((n) => ({ id: n.id, created_at: n.created_at })),
  { id: GHOST, created_at: '9999' },
];
const parentOfRefused = refused.args.parent_id as string;
const edgesForLayout = [
  ...final.edges.filter((e) => e.label !== 'tunes'),
  { source_node_id: parentOfRefused, target_node_id: GHOST },
];
const pos = layoutTree(layoutNodes, edgesForLayout, { hSpacing: 196, vSpacing: 56 });
const layout: Record<string, { x: number; y: number }> = {};
for (const [id, p] of pos) layout[id] = { x: p.x, y: p.y };

const twin = (refused.result.details as { id: string }[])[0].id;
const session = {
  schema: 1,
  kind: 'scripted',
  client: CLIENT,
  server: { name: 'living-mindmap', tools: tools.length, command: 'tsx src/mcp/index.ts', transport: 'stdio' },
  recorded_on: new Date().toISOString().slice(0, 10),
  frames: transport.frames,
  map: { id: mapId, title: final.map.title },
  nodes: final.nodes.map((n) => ({
    id: n.id,
    title: n.title,
    summary: n.summary,
    by: n.provenance === 'ai' ? 'agent' : 'hand',
    parent: parentOf.get(n.id) ?? final.edges.find((e) => e.target_node_id === n.id)?.source_node_id ?? null,
    step: stepOfNode.get(n.id) ?? null,
  })),
  edges: final.edges.map((e) => ({
    id: e.id,
    from: e.source_node_id,
    to: e.target_node_id,
    label: e.label,
    by: e.provenance === 'ai' ? 'agent' : 'hand',
    step: stepOfEdge.get(e.id) ?? null,
  })),
  touched,
  layout,
  ghost: { parent: parentOfRefused, twin, ...layout[GHOST] },
  calls,
};
fs.writeFileSync('demo/session.json', JSON.stringify(session) + '\n');
fs.rmSync(tmp, { recursive: true, force: true });
const bytes = fs.statSync('demo/session.json').size;
console.log(
  `Recorded ${calls.length} calls, ${transport.frames.sent + transport.frames.received} frames, ${bytes} bytes -> demo/session.json`,
);
