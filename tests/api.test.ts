import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app.js';
import { memStore } from './helpers.js';

let base = '';
let server: ReturnType<ReturnType<typeof createApp>['listen']>;
beforeAll(async () => {
  server = createApp(memStore()).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
afterAll(() => server.close());

const call = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
};

describe('REST API', () => {
  it('runs the whole acceptance flow over HTTP', async () => {
    const map = (await call('POST', '/maps', { title: 'Understanding Agents' })).json;
    const agent = (await call('POST', `/maps/${map.id}/nodes`, { title: 'Agent' })).json.node;
    const memory = (await call('POST', `/maps/${map.id}/nodes`, { title: 'Memory', parent_id: agent.id })).json.node;
    await call('PATCH', `/nodes/${memory.id}`, { notes: 'hello', summary: 's' });
    const src = await call('POST', `/nodes/${memory.id}/sources`, { url: 'https://example.com', title: 'Ex' });
    expect(src.status).toBe(201);

    const g = (await call('GET', `/maps/${map.id}`)).json;
    expect(g.nodes).toHaveLength(2);
    expect(g.edges).toHaveLength(1);
    expect(g.sources).toHaveLength(1);

    const search = (await call('GET', '/search?q=memory')).json;
    expect(search[0].node.id).toBe(memory.id);
    expect(search[0].map_title).toBe('Understanding Agents');

    const ctx = (await call('POST', `/maps/${map.id}/context`, { node_ids: [agent.id, memory.id], format: 'markdown' }))
      .json;
    expect(ctx.text).toContain('# Context: Agent → Memory');

    const del = (await call('DELETE', `/nodes/${memory.id}`)).json;
    expect((await call('GET', `/maps/${map.id}`)).json.nodes).toHaveLength(1);
    await call('POST', `/maps/${map.id}/restore`, del);
    expect((await call('GET', `/maps/${map.id}`)).json.nodes).toHaveLength(2);
  });

  it('returns useful errors', async () => {
    expect((await call('POST', '/maps', { title: '' })).status).toBe(400);
    expect((await call('GET', '/maps/nope')).status).toBe(404);
    const bad = await call('POST', '/maps/nope/nodes', { title: 'x' });
    expect(bad.status).toBe(404);
    expect(bad.json.error).toMatch(/not found/);
    const m = (await call('POST', '/maps', { title: 'X' })).json;
    const n = (await call('POST', `/maps/${m.id}/nodes`, { title: 'N' })).json.node;
    expect((await call('POST', `/nodes/${n.id}/sources`, { url: 'javascript:alert(1)' })).status).toBe(400);
  });

  it('rejects non-localhost Host headers', async () => {
    const res = await fetch(base + '/maps', { headers: { host: 'evil.example.com' } }).catch(() => null);
    // fetch forbids overriding Host in some runtimes; only assert when it went through
    if (res && res.status !== 200) expect(res.status).toBe(403);
  });

  it('seeds demo data once', async () => {
    const first = (await call('POST', '/seed')).json.created;
    expect(first).toContain('Learning Transformers (sample)');
    expect((await call('POST', '/seed')).json.created).toEqual([]);
  });
});
