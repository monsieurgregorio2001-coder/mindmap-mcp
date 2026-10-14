import { layoutTree } from '../shared/graph.js';
import type { Store } from './store.js';

type Spec = {
  title: string;
  summary?: string;
  notes?: string;
  tags?: string[];
  questions?: string[];
  children?: Spec[];
  label?: string;
};

const DEMOS: { title: string; description: string; root: Spec; links?: [string, string, string?][] }[] = [
  {
    title: 'Learning Transformers (sample)',
    description: 'SAMPLE DATA: a small example map about how transformer models work.',
    root: {
      title: 'Transformers',
      summary: 'Neural network architecture built around attention, behind most modern language models.',
      tags: ['sample', 'ml'],
      children: [
        {
          title: 'Self-Attention',
          summary: 'Each token weighs every other token to build a context-aware representation.',
          questions: ['Why does attention scale quadratically with sequence length?'],
          children: [
            { title: 'Queries, Keys, Values', summary: 'Three learned projections that drive the attention score.' },
            { title: 'Multi-Head Attention', summary: 'Several attention patterns computed in parallel and combined.' },
            { title: 'Causal Masking', summary: 'Prevents a token from attending to future tokens during training.' },
          ],
        },
        {
          title: 'Positional Encoding',
          summary: 'Injects word order, since attention alone is order-blind.',
          children: [
            { title: 'Sinusoidal Encoding', summary: 'Fixed sine and cosine patterns from the original paper.' },
            { title: 'Rotary Embeddings', summary: 'Encodes relative position by rotating query and key vectors.' },
          ],
        },
        {
          title: 'Architecture Blocks',
          summary: 'The repeated layers that make up the model.',
          children: [
            { title: 'Feed-Forward Layer', summary: 'Per-token MLP applied after attention in each block.' },
            { title: 'Residual Connections', summary: 'Skip paths that keep gradients healthy in deep stacks.' },
            { title: 'Layer Normalization', summary: 'Stabilizes activations between sublayers.' },
          ],
        },
        {
          title: 'Training',
          summary: 'How the weights are learned.',
          children: [
            { title: 'Next-Token Prediction', summary: 'Self-supervised objective used by decoder-only models.' },
            { title: 'Scaling Laws', summary: 'Loss improves predictably with more data, parameters and compute.' },
          ],
        },
        { title: 'Tokenization', summary: 'Splitting text into subword units the model can embed.' },
      ],
    },
    links: [
      ['Causal Masking', 'Next-Token Prediction', 'enables'],
      ['Tokenization', 'Positional Encoding', 'feeds into'],
    ],
  },
];

/** Adds demo maps. Skips any whose title already exists. Returns the titles created. */
export function seedDemo(store: Store): string[] {
  const existing = new Set(store.listMaps({ includeArchived: true }).map((m) => m.title));
  const created: string[] = [];
  for (const demo of DEMOS) {
    if (existing.has(demo.title)) continue;
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
    created.push(demo.title);
  }
  return created;
}
