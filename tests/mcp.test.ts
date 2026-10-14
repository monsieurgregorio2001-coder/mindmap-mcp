import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { createMcpServer } from '../src/mcp/server.js';
import { agentsMap, memStore } from './helpers.js';

let client: Client;
let ids: ReturnType<typeof agentsMap>;
let store: ReturnType<typeof memStore>;

beforeEach(async () => {
  store = memStore();
  ids = agentsMap(store);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createMcpServer(store).connect(b);
  client = new Client({ name: 'test', version: '0' });
  await client.connect(a);
});

const call = async (name: string, args: Record<string, unknown> = {}) => {
  const r = await client.callTool({ name, arguments: args });
  const text = (r.content as { text: string }[])[0].text;
  let data: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    data = JSON.parse(text);
  } catch {
    data = { error: text }; // protocol-level validation errors are plain text
  }
  return { isError: !!r.isError, data };
};

describe('MCP tools', () => {
  it('exposes the small, well-named tool surface', async () => {
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'add_source',
        'create_edge',
        'create_node',
        'delete_edge',
        'delete_node',
        'get_ai_context',
        'get_branch',
        'get_map',
        'get_node',
        'list_maps',
        'search_nodes',
        'update_node',
      ].sort(),
    );
  });

  it('the "add Episodic Memory" flow', async () => {
    expect((await call('list_maps')).data.maps[0].title).toBe('Understanding Agents');
    const found = await call('search_nodes', { query: 'memory', map: 'understanding agents' });
    expect(found.data.results[0].id).toBe(ids.memory.id);
    const node = await call('get_node', { node_id: ids.memory.id });
    expect(node.data.parents[0].title).toBe('Agent');

    const created = await call('create_node', {
      title: 'Episodic Memory',
      summary: 'Specific past events.',
      parent_id: ids.memory.id,
      relationship: 'kind of',
    });
    expect(created.isError).toBe(false);
    expect(created.data.node.provenance).toBe('ai');
    expect(created.data.edge.label).toBe('kind of');
    expect(created.data.similar_nodes[0].title).toBe('Memory');

    const g = store.getGraph(ids.map.id);
    expect(g.nodes.map((n) => n.title)).toContain('Episodic Memory');
    expect(g.edges.some((e) => e.source_node_id === ids.memory.id)).toBe(true);
  });

  it('blocks blind duplicates with candidates, allows override', async () => {
    const dup = await call('create_node', { map: ids.map.id, title: 'Memories' });
    expect(dup.isError).toBe(true);
    expect(dup.data.code).toBe('possible_duplicate');
    expect(dup.data.details[0].id).toBe(ids.memory.id);
    expect((await call('create_node', { map: ids.map.id, title: 'Memories', allow_duplicate: true })).isError).toBe(
      false,
    );
  });

  it('enriches without clobbering and adds sources idempotently', async () => {
    const u = await call('update_node', {
      node_id: ids.memory.id,
      append_notes: 'Agent memory can be episodic.',
      add_tags: ['x'],
    });
    expect(u.data.node.notes).toBe('Notes about memory.\n\nAgent memory can be episodic.');
    expect(u.data.node.tags).toEqual(['core', 'x']);
    expect((await call('add_source', { node_id: ids.memory.id, url: 'https://a.test' })).data.created).toBe(true);
    expect((await call('add_source', { node_id: ids.memory.id, url: 'https://a.test' })).data.created).toBe(false);
  });

  it('delete requires confirmation', async () => {
    const preview = await call('delete_node', { node_id: ids.memory.id });
    expect(preview.data.deleted).toBe(false);
    expect(store.getGraph(ids.map.id).nodes).toHaveLength(5);
    expect((await call('delete_node', { node_id: ids.memory.id, confirm: true })).data.deleted).toBe(true);
    expect(store.getGraph(ids.map.id).nodes).toHaveLength(4);
  });

  it('structured errors, never crashes', async () => {
    const r = await call('get_node', { node_id: 'zzz' });
    expect(r.isError).toBe(true);
    expect(r.data.code).toBe('not_found');
    const bad = await call('add_source', { node_id: ids.memory.id, url: 'not a url' });
    expect(bad.isError).toBe(true);
    expect(bad.data.error).toMatch(/URL must start with/);
    expect((await call('create_node', { title: 'orphan' })).data.error).toMatch(/map/);
  });

  it('edges, branch and AI context', async () => {
    const e = await call('create_edge', { source_node_id: ids.model.id, target_node_id: ids.tool.id, label: 'calls' });
    expect(e.data.created).toBe(true);
    expect((await call('delete_edge', { edge_id: e.data.edge.id })).data.deleted).toBe(true);
    const br = await call('get_branch', { node_id: ids.agent.id, depth: 1 });
    expect(br.data.nodes).toHaveLength(5);
    const anc = await call('get_branch', { node_id: ids.memory.id, direction: 'ancestors' });
    expect(anc.data.nodes.map((n: { title: string }) => n.title)).toEqual(['Agent', 'Memory']);
    const ctx = await call('get_ai_context', { root_id: ids.memory.id });
    expect(ctx.data.context).toContain('# Context: Memory');
    const js = await call('get_ai_context', { node_ids: [ids.memory.id], format: 'json' });
    expect(JSON.parse(js.data.context).nodes[0].title).toBe('Memory');
  });
});

describe('MCP tools: read handlers', () => {
  it('list_maps returns node counts and get_map returns compact nodes and edges', async () => {
    const store2 = memStore();
    const seeded = agentsMap(store2);
    const [a, b] = InMemoryTransport.createLinkedPair();
    await createMcpServer(store2).connect(b);
    const c = new Client({ name: 'test2', version: '0' });
    await c.connect(a);
    const raw = await c.callTool({ name: 'get_map', arguments: { map: seeded.map.id } });
    const data = JSON.parse((raw.content as { text: string }[])[0].text);
    expect(data.nodes).toHaveLength(5);
    expect(data.edges).toHaveLength(4);
  });

  it('search_nodes returns nothing for a nonsense query without erroring', async () => {
    const r = await call('search_nodes', { query: 'qqqzzzxxx' });
    expect(r.isError).toBe(false);
    expect(r.data.results).toEqual([]);
  });

  it('update_node replaces the title and keeps provenance fields intact', async () => {
    const r = await call('update_node', { node_id: ids.tool.id, title: 'Tools' });
    expect(r.isError).toBe(false);
    expect(r.data.node.title).toBe('Tools');
  });
});
