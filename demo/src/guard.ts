// The demo's guard: the repo's pure similar.ts over an in-memory node list. No database, no Node APIs.
import { exactMatch, type GuardPair, type ScoredPair } from '../../src/core/guard-eval.js';
import type { Spec } from '../../src/core/seed-spec.js';
import {
  DUPLICATE_THRESHOLD,
  duplicateDetails,
  duplicateMessage,
  findSimilar,
  isDuplicate,
} from '../../src/core/similar.js';
import { MindmapError, type MindNode, type SimilarNode } from '../../src/core/types.js';

export { DUPLICATE_THRESHOLD, exactMatch };

export function makeNode(id: string, title: string, summary = ''): MindNode {
  return {
    id,
    map_id: 'demo',
    title,
    summary,
    notes: '',
    tags: [],
    questions: [],
    status: 'seed',
    provenance: 'user',
    x: 0,
    y: 0,
    collapsed: false,
    created_at: '',
    updated_at: '',
  };
}

/** Flattens a seed spec into nodes and parent links, depth first. The id is the title, which is unique in the sample map. */
export function flattenSpec(root: Spec): { nodes: MindNode[]; parents: Map<string, string | null>; order: string[] } {
  const nodes: MindNode[] = [];
  const parents = new Map<string, string | null>();
  const walk = (s: Spec, parent: string | null) => {
    nodes.push(makeNode(s.title, s.title, s.summary ?? ''));
    parents.set(s.title, parent);
    for (const c of s.children ?? []) walk(c, s.title);
  };
  walk(root, null);
  return { nodes, parents, order: nodes.map((n) => n.id) };
}

export interface GuardVerdict {
  candidates: SimilarNode[];
  duplicates: SimilarNode[];
  best: SimilarNode | null;
  refused: boolean;
}

/** An in-memory map. `check` is what the server's findSimilar and isDuplicate say about a title. */
export class MemoryStore {
  constructor(public nodes: MindNode[]) {}

  check(title: string): GuardVerdict {
    const candidates = findSimilar(this.nodes, title);
    const duplicates = candidates.filter(isDuplicate);
    return { candidates, duplicates, best: candidates[0] ?? null, refused: duplicates.length > 0 };
  }

  /** Same refusal as the server's create_node (rejectDuplicates on). Throws MindmapError('possible_duplicate'). */
  createNode(id: string, title: string): MindNode {
    const { duplicates } = this.check(title);
    if (duplicates.length)
      throw new MindmapError('possible_duplicate', duplicateMessage(title, duplicates), duplicateDetails(duplicates));
    const node = makeNode(id, title);
    this.nodes.push(node);
    return node;
  }
}

/** The guard's score for one labelled pair, through the in-memory store. */
export function pairScore(a: string, b: string): number {
  return new MemoryStore([makeNode('a', a)]).check(b).best?.score ?? 0;
}

export const scoreAll = (pairs: GuardPair[]): ScoredPair[] => pairs.map((p) => ({ ...p, score: pairScore(p.a, p.b) }));
