import { describe, expect, it } from 'vitest';
import { seedDemo } from '../src/core/seed.js';
import { memStore } from './helpers.js';

describe('sample seed', () => {
  it('creates one clearly labeled sample map with about 15 nodes', () => {
    const s = memStore();
    const created = seedDemo(s);
    expect(created).toEqual(['Learning Transformers (sample)']);
    const map = s.listMaps({ includeArchived: true })[0];
    expect(map.description).toMatch(/SAMPLE DATA/);
    const g = s.getGraph(map.id);
    expect(g.nodes.length).toBeGreaterThanOrEqual(15);
    expect(g.nodes.length).toBeLessThanOrEqual(20);
    expect(g.edges.length).toBeGreaterThanOrEqual(g.nodes.length - 1);
  });

  it('is idempotent', () => {
    const s = memStore();
    seedDemo(s);
    expect(seedDemo(s)).toEqual([]);
  });
});
