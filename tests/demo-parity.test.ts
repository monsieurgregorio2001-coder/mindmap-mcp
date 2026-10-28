// Parity: the browser demo's guard gives the server's scores. Both paths below are independent of each other:
// the server side runs the real Store on SQLite, the demo side runs MemoryStore over plain objects.
import { describe, expect, it } from 'vitest';
import pairsFile from '../evals/guard-pairs.json';
import { flattenSpec, MemoryStore, makeNode, pairScore, scoreAll } from '../demo/src/guard.js';
import { scorePairs, type GuardPair } from '../src/core/guard-eval.js';
import { openDb } from '../src/core/db.js';
import { seedSpec } from '../src/core/seed.js';
import { DEMOS, SUPPORT_INBOX } from '../src/core/seed-spec.js';
import { Store } from '../src/core/store.js';
import { MindmapError } from '../src/core/types.js';

const pairs = pairsFile.pairs as GuardPair[];
const serverStore = () => new Store(openDb(':memory:'));

// Probe titles: every pair title, every fixture node title, and some near-misses of each.
const fixtureTitles = [SUPPORT_INBOX, ...DEMOS].flatMap((d) => flattenSpec(d.root).nodes.map((n) => n.title));
const probes = [
  ...new Set([
    ...pairs.flatMap((p) => [p.a, p.b]),
    ...fixtureTitles,
    ...fixtureTitles.map((t) => t.toUpperCase()),
    ...fixtureTitles.map((t) => `${t}s`),
    ...fixtureTitles.map((t) => t.split(' ').reverse().join(' ')),
    'Help-centre articles',
    'Saved replies',
    '',
    '   ',
    '!!!',
  ]),
];

describe('demo guard parity with the server findSimilar', () => {
  for (const demo of [SUPPORT_INBOX, ...DEMOS]) {
    it(`every probe title scores the same against "${demo.title}"`, () => {
      const store = serverStore();
      const mapId = seedSpec(store, demo);
      const memory = new MemoryStore(flattenSpec(demo.root).nodes);
      let compared = 0;
      for (const title of probes) {
        const server = store.similarNodes(mapId, title).map((s) => [s.node.title, s.score, s.reason]);
        const demoSide = memory.check(title).candidates.map((s) => [s.node.title, s.score, s.reason]);
        expect(demoSide, `probe "${title}"`).toEqual(server);
        compared++;
      }
      expect(compared).toBeGreaterThan(100);
    });

    it(`refuses and allows the same titles with the same message for "${demo.title}"`, () => {
      const store = serverStore();
      const mapId = seedSpec(store, demo);
      // Same ids on both sides, so the refusal text can be compared character for character.
      const memory = new MemoryStore(store.getGraph(mapId).nodes);
      for (const title of probes.filter((t) => t.trim())) {
        let serverErr: MindmapError | null = null;
        let newId = 'new';
        try {
          newId = store.createNode(mapId, { title }, { provenance: 'ai', rejectDuplicates: true }).node.id;
        } catch (e) {
          serverErr = e as MindmapError;
        }
        let demoErr: MindmapError | null = null;
        try {
          memory.createNode(newId, title); // allowed titles are added on both sides, so later probes see the same map
        } catch (e) {
          demoErr = e as MindmapError;
        }
        expect(demoErr?.code ?? null, `probe "${title}"`).toBe(serverErr?.code ?? null);
        expect(demoErr?.message).toBe(serverErr?.message);
        expect(demoErr?.details).toEqual(serverErr?.details);
      }
    });
  }

  it('scores every labelled pair the same as the server', () => {
    expect(pairs).toHaveLength(60);
    for (const p of pairs) {
      const store = serverStore();
      const mapId = store.createMap({ title: 'pair' }).id;
      store.createNode(mapId, { title: p.a }, { provenance: 'user' });
      const server = store.similarNodes(mapId, p.b)[0]?.score ?? 0;
      expect(pairScore(p.a, p.b), `${p.a} | ${p.b}`).toBe(server);
    }
  });

  it('keeps the eval scorer in line with the demo scorer', () => {
    expect(scoreAll(pairs).map((p) => p.score)).toEqual(scorePairs(pairs).map((p) => p.score));
  });

  it('makeNode builds a node the guard can score', () => {
    expect(new MemoryStore([makeNode('x', 'Canned answers')]).check('Canned answer').refused).toBe(true);
  });
});
