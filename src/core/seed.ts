import { layoutTree } from '../shared/graph.js';
import { DEMOS, type DemoSpec, type Spec } from './seed-spec.js';
import type { Store } from './store.js';

/** Creates one map from a spec through the Store. Returns the new map id. */
export function seedSpec(store: Store, demo: DemoSpec): string {
  const map = store.createMap({ title: demo.title, description: demo.description });
  const byTitle = new Map<string, string>();
  const add = (spec: Spec, parentId?: string) => {
    const { node } = store.createNode(
      map.id,
      {
        title: spec.title,
        summary: spec.summary,
        notes: spec.notes,
        tags: spec.tags,
        questions: spec.questions,
        parent_id: parentId,
        relationship: spec.label,
      },
      { provenance: 'user' },
    );
    byTitle.set(spec.title, node.id);
    for (const c of spec.children ?? []) add(c, node.id);
  };
  add(demo.root);
  for (const [a, b, label] of demo.links ?? []) {
    store.createEdge(map.id, { source_node_id: byTitle.get(a)!, target_node_id: byTitle.get(b)!, label });
  }
  const g = store.getGraph(map.id);
  store.setPositions(
    map.id,
    [...layoutTree(g.nodes, g.edges)].map(([id, p]) => ({ id, ...p })),
  );
  return map.id;
}

/** Adds demo maps. Skips any whose title already exists. Returns the titles created. */
export function seedDemo(store: Store): string[] {
  const existing = new Set(store.listMaps({ includeArchived: true }).map((m) => m.title));
  const created: string[] = [];
  for (const demo of DEMOS) {
    if (existing.has(demo.title)) continue;
    seedSpec(store, demo);
    created.push(demo.title);
  }
  return created;
}
