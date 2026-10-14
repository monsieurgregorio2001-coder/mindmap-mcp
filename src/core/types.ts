export const PROVENANCES = ['user', 'ai', 'source'] as const;
export const NODE_STATUSES = ['seed', 'exploring', 'understood'] as const;
export type Provenance = (typeof PROVENANCES)[number];
export type NodeStatus = (typeof NODE_STATUSES)[number];

export interface MindMap {
  id: string;
  title: string;
  description: string;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface MapSummary extends MindMap {
  node_count: number;
}

export interface MindNode {
  id: string;
  map_id: string;
  title: string;
  summary: string;
  notes: string;
  tags: string[];
  questions: string[];
  status: NodeStatus;
  provenance: Provenance;
  x: number;
  y: number;
  collapsed: boolean;
  created_at: string;
  updated_at: string;
}

export interface MindEdge {
  id: string;
  map_id: string;
  source_node_id: string;
  target_node_id: string;
  label: string;
  provenance: Provenance;
  created_at: string;
}

export interface MindSource {
  id: string;
  node_id: string;
  title: string;
  url: string;
  notes: string;
  provenance: Provenance;
  created_at: string;
}

export interface MapGraph {
  map: MindMap;
  nodes: MindNode[];
  edges: MindEdge[];
  sources: MindSource[];
}

/** Everything removed by a delete, so the caller can offer undo. */
export interface DeletedSnapshot {
  map_id: string;
  nodes: MindNode[];
  edges: MindEdge[];
  sources: MindSource[];
}

export interface SearchHit {
  node: MindNode;
  map_title: string;
  score: number;
  matched: Array<'title' | 'summary' | 'notes' | 'tags'>;
  snippet: string;
}

export interface SimilarNode {
  node: MindNode;
  score: number;
  reason: string;
}

export class MindmapError extends Error {
  constructor(
    public code: 'not_found' | 'invalid' | 'conflict' | 'possible_duplicate' | 'ambiguous',
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'MindmapError';
  }
}
