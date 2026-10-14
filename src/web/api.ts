import type {
  DeletedSnapshot,
  MapGraph,
  MapSummary,
  MindEdge,
  MindMap,
  MindNode,
  MindSource,
  SearchHit,
} from '../core/types';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('Cannot reach the Living Mindmap server. Is it running?', 0);
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status);
  return data as T;
}

export type NodePatch = Partial<
  Pick<MindNode, 'title' | 'summary' | 'notes' | 'tags' | 'questions' | 'status' | 'x' | 'y' | 'collapsed'>
>;
export interface NewNode {
  title: string;
  parent_id?: string;
  relationship?: string;
  x?: number;
  y?: number;
}

export const api = {
  listMaps: (archived: boolean) => request<MapSummary[]>('GET', `/maps${archived ? '?archived=1' : ''}`),
  createMap: (title: string, description = '') => request<MindMap>('POST', '/maps', { title, description }),
  updateMap: (id: string, patch: Partial<Pick<MindMap, 'title' | 'description' | 'archived'>>) =>
    request<MindMap>('PATCH', `/maps/${id}`, patch),
  deleteMap: (id: string) => request<void>('DELETE', `/maps/${id}`),
  getGraph: (id: string) => request<MapGraph>('GET', `/maps/${id}`),
  seed: () => request<{ created: string[] }>('POST', '/seed'),

  createNode: (mapId: string, n: NewNode) =>
    request<{ node: MindNode; edge?: MindEdge }>('POST', `/maps/${mapId}/nodes`, n),
  updateNode: (id: string, patch: NodePatch) => request<MindNode>('PATCH', `/nodes/${id}`, patch),
  deleteNode: (id: string) => request<DeletedSnapshot>('DELETE', `/nodes/${id}`),
  restore: (mapId: string, snap: DeletedSnapshot) => request<MapGraph>('POST', `/maps/${mapId}/restore`, snap),
  setPositions: (mapId: string, positions: { id: string; x: number; y: number }[]) =>
    request<void>('PUT', `/maps/${mapId}/positions`, { positions }),

  createEdge: (mapId: string, source: string, target: string, label = '') =>
    request<MindEdge>('POST', `/maps/${mapId}/edges`, { source_node_id: source, target_node_id: target, label }),
  updateEdge: (id: string, label: string) => request<MindEdge>('PATCH', `/edges/${id}`, { label }),
  deleteEdge: (id: string) => request<MindEdge>('DELETE', `/edges/${id}`),

  addSource: (nodeId: string, s: { url: string; title?: string; notes?: string }) =>
    request<MindSource>('POST', `/nodes/${nodeId}/sources`, s),
  updateSource: (id: string, s: Partial<Pick<MindSource, 'url' | 'title' | 'notes'>>) =>
    request<MindSource>('PATCH', `/sources/${id}`, s),
  deleteSource: (id: string) => request<MindSource>('DELETE', `/sources/${id}`),

  search: (q: string, mapId?: string) =>
    request<SearchHit[]>('GET', `/search?q=${encodeURIComponent(q)}${mapId ? `&map_id=${mapId}` : ''}`),
  context: (mapId: string, nodeIds: string[], format: 'markdown' | 'json') =>
    request<{ text: string; node_count: number }>('POST', `/maps/${mapId}/context`, { node_ids: nodeIds, format }),
};
