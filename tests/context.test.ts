import { describe, expect, it } from 'vitest';
import { agentsMap, memStore } from './helpers.js';

describe('AI context export', () => {
  it('renders a chain as a titled path with relationships, questions and sources', () => {
    const s = memStore();
    const map = s.createMap({ title: 'Solar System' });
    const nf = s.createNode(map.id, { title: 'Solar System', summary: 'Star and planets' }).node;
    const perf = s.createNode(map.id, { title: 'Planets', parent_id: nf.id, summary: 'Shaped behaviour' }).node;
    const auth = s.createNode(map.id, {
      title: 'Mars',
      parent_id: perf.id,
      relationship: 'tests',
      notes: 'Is it real?',
      questions: ['Can it be real?'],
    }).node;
    s.addSource(auth.id, { url: 'https://example.com/a', title: 'Essay' });
    s.createNode(map.id, { title: 'Unrelated', parent_id: nf.id });

    const { text } = s.getContext(map.id, { nodeIds: [nf.id, perf.id, auth.id] });
    expect(text).toContain('# Context: Solar System → Planets → Mars');
    expect(text).toContain('## Planets\nRelationship: Solar System → Planets');
    expect(text).toContain('Relationship: Planets → Mars (tests)');
    expect(text).toContain('Notes:\nIs it real?');
    expect(text).toContain('## Open Questions\n- Can it be real? _(Mars)_');
    expect(text).toContain('## Sources\n- [Essay](https://example.com/a) _(Mars)_');
    expect(text).not.toContain('Unrelated');
  });

  it('exports a branch (root + descendants) and valid JSON', () => {
    const s = memStore();
    const a = agentsMap(s);
    s.createNode(a.map.id, { title: 'Episodic Memory', parent_id: a.memory.id });
    const md = s.getContext(a.map.id, { rootId: a.memory.id });
    expect(md.node_count).toBe(2);
    expect(md.text).toContain('# Context: Memory → Episodic Memory');
    const json = JSON.parse(s.getContext(a.map.id, { rootId: a.memory.id }, 'json').text);
    expect(json.nodes.map((n: { title: string }) => n.title)).toEqual(['Memory', 'Episodic Memory']);
    expect(json.relationships).toHaveLength(1);
    expect(json.nodes[0].open_questions).toEqual(['What to forget?']);
  });

  it('errors on unknown ids and empty selections', () => {
    const s = memStore();
    const a = agentsMap(s);
    expect(() => s.getContext(a.map.id, { nodeIds: ['nope'] })).toThrow(/not found/);
    expect(() => s.getContext(a.map.id, {})).toThrow(/Select at least one/);
  });

  it('summarises non-chain selections by their root', () => {
    const s = memStore();
    const a = agentsMap(s);
    const { text } = s.getContext(a.map.id, { rootId: a.agent.id });
    expect(text.split('\n')[0]).toBe('# Context: Agent (+4 related nodes)');
  });

  it('marks AI provenance', () => {
    const s = memStore();
    const a = agentsMap(s);
    const n = s.createNode(a.map.id, { title: 'Episodic Memory', parent_id: a.memory.id }, { provenance: 'ai' }).node;
    expect(s.getContext(a.map.id, { nodeIds: [n.id] }).text).toContain('Provenance: AI-added');
  });
});
