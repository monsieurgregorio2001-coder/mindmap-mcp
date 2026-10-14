import { describe, expect, it } from 'vitest';
import { branchIds, hiddenByCollapse, layoutTree, pathToRoot } from '../src/shared/graph.js';

const e = (a: string, b: string) => ({ source_node_id: a, target_node_id: b });
const edges = [e('a', 'b'), e('b', 'c'), e('c', 'd'), e('a', 'x')];
const n = (id: string, collapsed = false) => ({ id, collapsed });

describe('graph helpers', () => {
  it('branchIds follows edges forward with optional depth', () => {
    expect(branchIds('b', edges)).toEqual(['b', 'c', 'd']);
    expect(branchIds('a', edges, 1)).toEqual(['a', 'b', 'x']);
  });
  it('pathToRoot walks up', () => {
    expect(pathToRoot('d', edges)).toEqual(['a', 'b', 'c', 'd']);
  });
  it('survives cycles', () => {
    const cyc = [e('a', 'b'), e('b', 'a')];
    expect(branchIds('a', cyc)).toEqual(['a', 'b']);
    expect(pathToRoot('a', cyc)).toEqual(['b', 'a']);
  });
  it('hides descendants of collapsed nodes only', () => {
    const nodes = [n('a'), n('b', true), n('c'), n('d'), n('x')];
    expect([...hiddenByCollapse(nodes, edges)].sort()).toEqual(['c', 'd']);
  });
  it('keeps a node visible if another visible parent reaches it', () => {
    const ed = [e('a', 'b'), e('b', 'c'), e('a', 'c')];
    expect(hiddenByCollapse([n('a'), n('b', true), n('c')], ed).size).toBe(0);
  });
  it('lays out a tree left to right without overlaps', () => {
    const nodes = ['a', 'b', 'c', 'd', 'x'].map((id, i) => ({ id, created_at: String(i) }));
    const pos = layoutTree(nodes, edges);
    expect(pos.get('a')!.x).toBe(0);
    expect(pos.get('d')!.x).toBe(900);
    const keys = [...pos.values()].map((p) => `${p.x},${p.y}`);
    expect(new Set(keys).size).toBe(5);
    expect(pos.get('a')!.y).toBeCloseTo((pos.get('b')!.y + pos.get('x')!.y) / 2);
  });
  it('places cycle-only nodes too', () => {
    const pos = layoutTree([{ id: 'a' }, { id: 'b' }], [e('a', 'b'), e('b', 'a')]);
    expect(pos.size).toBe(2);
  });
});
