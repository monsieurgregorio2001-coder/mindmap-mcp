import { describe, expect, it } from 'vitest';
import { MindmapError } from '../src/core/types.js';
import { agentsMap, memStore } from './helpers.js';

describe('maps', () => {
  it('creates, renames, archives and deletes', () => {
    const s = memStore();
    const m = s.createMap({ title: 'Philosophy', description: 'x' });
    expect(s.listMaps()).toHaveLength(1);
    s.updateMap(m.id, { title: 'Phil', archived: true });
    expect(s.listMaps()).toHaveLength(0);
    expect(s.listMaps({ includeArchived: true })[0].title).toBe('Phil');
    s.deleteMap(m.id);
    expect(s.listMaps({ includeArchived: true })).toHaveLength(0);
  });

  it('resolves by id, exact title, unique partial; errors on ambiguity', () => {
    const s = memStore();
    const a = s.createMap({ title: 'AI Agents' });
    s.createMap({ title: 'Solar System' });
    s.createMap({ title: 'Solar Explorer' });
    expect(s.resolveMap(a.id).id).toBe(a.id);
    expect(s.resolveMap('ai agents').id).toBe(a.id);
    expect(s.resolveMap('system').title).toBe('Solar System');
    expect(() => s.resolveMap('solar')).toThrowError(/several maps/);
    expect(() => s.resolveMap('zzz')).toThrowError(MindmapError);
  });

  it('counts nodes and bumps updated_at on change', async () => {
    const s = memStore();
    const { map } = agentsMap(s);
    const before = s.getMap(map.id).updated_at;
    expect(s.listMaps()[0].node_count).toBe(5);
    await new Promise((r) => setTimeout(r, 5));
    s.createNode(map.id, { title: 'Extra' });
    expect(s.getMap(map.id).updated_at > before).toBe(true);
  });
});

describe('nodes & edges', () => {
  it('creates a child with edge and places it right of the parent', () => {
    const s = memStore();
    const { agent, model, map } = agentsMap(s);
    const g = s.getGraph(map.id);
    expect(g.edges).toHaveLength(4);
    expect(model.x).toBeGreaterThan(agent.x);
  });

  it('does not stack nodes on top of each other', () => {
    const s = memStore();
    const { map, agent } = agentsMap(s);
    const pts = s.getGraph(map.id).nodes.map((n) => `${n.x},${n.y}`);
    expect(new Set(pts).size).toBe(pts.length);
    void agent;
  });

  it('rejects self loops, cross-map edges, and is idempotent for repeats', () => {
    const s = memStore();
    const a = agentsMap(s);
    const other = s.createMap({ title: 'Other' });
    const o = s.createNode(other.id, { title: 'O' }).node;
    expect(() => s.createEdge(a.map.id, { source_node_id: a.agent.id, target_node_id: a.agent.id })).toThrow(/itself/);
    expect(() => s.createEdge(a.map.id, { source_node_id: a.agent.id, target_node_id: o.id })).toThrow(/same map/);
    const first = s.createEdge(a.map.id, { source_node_id: a.model.id, target_node_id: a.tool.id, label: 'x' });
    const again = s.createEdge(a.map.id, { source_node_id: a.model.id, target_node_id: a.tool.id });
    const reverse = s.createEdge(a.map.id, { source_node_id: a.tool.id, target_node_id: a.model.id });
    expect(first.created).toBe(true);
    expect(again.created).toBe(false);
    expect(reverse.created).toBe(false);
  });

  it('delete returns a snapshot and restore brings everything back', () => {
    const s = memStore();
    const a = agentsMap(s);
    s.addSource(a.memory.id, { url: 'https://example.com', title: 'Ex' });
    const snap = s.deleteNode(a.memory.id);
    expect(s.getGraph(a.map.id).nodes).toHaveLength(4);
    expect(snap.edges).toHaveLength(1);
    expect(snap.sources).toHaveLength(1);
    s.restore(snap);
    const g = s.getGraph(a.map.id);
    expect(g.nodes).toHaveLength(5);
    expect(g.edges).toHaveLength(4);
    expect(g.sources).toHaveLength(1);
    expect(g.nodes.find((n) => n.id === a.memory.id)?.notes).toBe('Notes about memory.');
  });

  it('dedupes tags, appends without clobbering, validates sources', () => {
    const s = memStore();
    const { memory } = agentsMap(s);
    const n = s.appendToNode(memory.id, { tags: ['core', 'new'], notes: 'More.', questions: ['Q2'] });
    expect(n.tags).toEqual(['core', 'new']);
    expect(n.notes).toBe('Notes about memory.\n\nMore.');
    expect(n.questions).toEqual(['What to forget?', 'Q2']);
    const a = s.addSource(memory.id, { url: 'https://a.test' });
    const b = s.addSource(memory.id, { url: 'https://a.test' });
    expect(b.created).toBe(false);
    expect(b.source.id).toBe(a.source.id);
  });

  it('deleting a map cascades', () => {
    const s = memStore();
    const a = agentsMap(s);
    s.deleteMap(a.map.id);
    expect(s.db.prepare('SELECT COUNT(*) c FROM nodes').get()).toEqual({ c: 0 });
    expect(s.db.prepare('SELECT COUNT(*) c FROM edges').get()).toEqual({ c: 0 });
  });
});

describe('duplicates', () => {
  it('rejects near-duplicates when asked, but allows genuine specialisations', () => {
    const s = memStore();
    const { map } = agentsMap(s);
    const tryCreate = (title: string) => s.createNode(map.id, { title }, { provenance: 'ai', rejectDuplicates: true });
    expect(() => tryCreate('memory')).toThrowError(/already exists/);
    expect(() => tryCreate('Memories')).toThrowError(/already exists/);
    expect(() => tryCreate('Tools')).toThrowError(/already exists/);
    expect(() => tryCreate('Episodic Memory')).not.toThrow();
  });

  it('flags the four-ways-to-say-agent-memory problem', () => {
    const s = memStore();
    const map = s.createMap({ title: 'AI Agents' });
    s.createNode(map.id, { title: 'Agent Memory' });
    for (const t of ['AI Agent Memory', 'Memory for Agents', 'agent-memory', 'Agent Memorry']) {
      expect(() => s.createNode(map.id, { title: t }, { rejectDuplicates: true }), t).toThrowError(MindmapError);
    }
    expect(() => s.createNode(map.id, { title: 'Long-Term Agent Memory' }, { rejectDuplicates: true })).not.toThrow();
  });
});

describe('search', () => {
  it('searches title, summary, notes and tags; title ranks first', () => {
    const s = memStore();
    const { map, memory } = agentsMap(s);
    s.createNode(map.id, { title: 'Planning', summary: 'uses memory to plan' });
    const hits = s.search('memory', { mapId: map.id });
    expect(hits[0].node.id).toBe(memory.id);
    expect(hits.length).toBe(2);
    expect(s.search('core')[0].matched).toContain('tags');
    expect(s.search('"forget"'.replace(/"/g, ''))).toHaveLength(0); // questions aren't searched
    expect(s.search('notes about')[0].node.id).toBe(memory.id);
    expect(s.search('memory zzz')).toHaveLength(0);
  });

  it('ignores archived maps', () => {
    const s = memStore();
    const { map } = agentsMap(s);
    s.updateMap(map.id, { archived: true });
    expect(s.search('memory')).toHaveLength(0);
  });
});

describe('persistence', () => {
  it('survives closing and reopening the database file', async () => {
    const { openDb } = await import('../src/core/db.js');
    const { Store } = await import('../src/core/store.js');
    const os = await import('node:os');
    const path = await import('node:path');
    const fs = await import('node:fs');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-'));
    const file = path.join(dir, 'x.db');
    const db1 = openDb(file);
    const s1 = new Store(db1);
    const a = agentsMap(s1);
    s1.addSource(a.memory.id, { url: 'https://a.test' });
    db1.close();
    const s2 = new Store(openDb(file));
    const g = s2.getGraph(a.map.id);
    expect(g.nodes).toHaveLength(5);
    expect(g.sources).toHaveLength(1);
    fs.rmSync(dir, { recursive: true });
  });
});
