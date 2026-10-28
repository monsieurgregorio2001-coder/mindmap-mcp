import { randomBytes } from 'node:crypto';
import { branchIds, pathToRoot } from '../shared/graph.js';
import { buildContext, type ContextFormat } from './context.js';
import type { Db } from './db.js';
import {
  sourceCreate,
  type EdgeCreate,
  type MapCreate,
  type MapUpdate,
  type NodeCreate,
  type NodeUpdate,
  type SourceCreate,
  type SourceUpdate,
} from './schemas.js';
import { duplicateDetails, duplicateMessage, findSimilar, isDuplicate } from './similar.js';
import {
  MindmapError,
  type DeletedSnapshot,
  type MapGraph,
  type MapSummary,
  type MindEdge,
  type MindMap,
  type MindNode,
  type MindSource,
  type Provenance,
  type SearchHit,
  type SimilarNode,
} from './types.js';

const now = () => new Date().toISOString();
const newId = (prefix: string) => `${prefix}_${randomBytes(5).toString('hex')}`;
const parseJsonArray = (s: string): string[] => {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
};
const dedupe = (xs: string[]) => [...new Set(xs.map((x) => x.trim()).filter(Boolean))];

/* eslint-disable @typescript-eslint/no-explicit-any */
const toMap = (r: any): MindMap => ({ ...r, archived: !!r.archived });
const toNode = (r: any): MindNode => ({
  ...r,
  tags: parseJsonArray(r.tags),
  questions: parseJsonArray(r.questions),
  collapsed: !!r.collapsed,
});
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface CreateNodeOptions {
  provenance?: Provenance;
  /** Refuse (error `possible_duplicate`) if a node with a near-identical title already exists in the map. */
  rejectDuplicates?: boolean;
}

export class Store {
  constructor(readonly db: Db) {}

  /* ───────────── maps ───────────── */

  listMaps(opts: { includeArchived?: boolean } = {}): MapSummary[] {
    const rows = this.db
      .prepare(
        `SELECT m.*, (SELECT COUNT(*) FROM nodes n WHERE n.map_id = m.id) AS node_count
         FROM maps m ${opts.includeArchived ? '' : 'WHERE m.archived = 0'}
         ORDER BY m.updated_at DESC`,
      )
      .all();
    return rows.map((r) => ({ ...toMap(r), node_count: (r as { node_count: number }).node_count }));
  }

  getMap(id: string): MindMap {
    const row = this.db.prepare('SELECT * FROM maps WHERE id = ?').get(id);
    if (!row) throw new MindmapError('not_found', `Map "${id}" not found`);
    return toMap(row);
  }

  /** Accepts an id, an exact title, or a unique partial title (case-insensitive). */
  resolveMap(idOrTitle: string): MindMap {
    const q = idOrTitle.trim();
    const byId = this.db.prepare('SELECT * FROM maps WHERE id = ?').get(q);
    if (byId) return toMap(byId);
    const all = this.db.prepare('SELECT * FROM maps').all().map(toMap);
    const lower = q.toLowerCase();
    const exact = all.filter((m) => m.title.toLowerCase() === lower);
    const pool = exact.length ? exact : all.filter((m) => m.title.toLowerCase().includes(lower));
    if (pool.length === 1) return pool[0];
    if (pool.length === 0)
      throw new MindmapError('not_found', `No map matches "${idOrTitle}". Use list_maps to see available maps.`);
    throw new MindmapError(
      'ambiguous',
      `"${idOrTitle}" matches several maps: ${pool.map((m) => `${m.title} (${m.id})`).join('; ')}. Use the id.`,
      pool.map((m) => ({ id: m.id, title: m.title })),
    );
  }

  createMap(input: MapCreate): MindMap {
    const t = now();
    const id = newId('m');
    this.db
      .prepare('INSERT INTO maps (id, title, description, archived, created_at, updated_at) VALUES (?,?,?,?,?,?)')
      .run(id, input.title, input.description ?? '', 0, t, t);
    return this.getMap(id);
  }

  updateMap(id: string, patch: MapUpdate): MindMap {
    const cur = this.getMap(id);
    this.db
      .prepare('UPDATE maps SET title=?, description=?, archived=?, updated_at=? WHERE id=?')
      .run(
        patch.title ?? cur.title,
        patch.description ?? cur.description,
        (patch.archived ?? cur.archived) ? 1 : 0,
        now(),
        id,
      );
    return this.getMap(id);
  }

  deleteMap(id: string): void {
    this.getMap(id);
    this.db.prepare('DELETE FROM maps WHERE id = ?').run(id);
  }

  private touchMap(mapId: string): void {
    this.db.prepare('UPDATE maps SET updated_at = ? WHERE id = ?').run(now(), mapId);
  }

  getGraph(mapId: string): MapGraph {
    const map = this.getMap(mapId);
    const nodes = this.db
      .prepare('SELECT * FROM nodes WHERE map_id = ? ORDER BY created_at, id')
      .all(mapId)
      .map(toNode);
    const edges = this.db
      .prepare('SELECT * FROM edges WHERE map_id = ? ORDER BY created_at, id')
      .all(mapId) as MindEdge[];
    const sources = this.db
      .prepare(
        'SELECT s.* FROM sources s JOIN nodes n ON n.id = s.node_id WHERE n.map_id = ? ORDER BY s.created_at, s.id',
      )
      .all(mapId) as MindSource[];
    return { map, nodes, edges, sources };
  }

  /* ───────────── nodes ───────────── */

  getNode(id: string): MindNode {
    const row = this.db.prepare('SELECT * FROM nodes WHERE id = ?').get(id);
    if (!row) throw new MindmapError('not_found', `Node "${id}" not found`);
    return toNode(row);
  }

  /** A node plus its immediate neighbours and sources: what an agent needs to decide where new knowledge belongs. */
  getNodeContext(id: string) {
    const node = this.getNode(id);
    const edges = this.db
      .prepare('SELECT * FROM edges WHERE source_node_id = ? OR target_node_id = ?')
      .all(id, id) as MindEdge[];
    return {
      node,
      parents: edges
        .filter((e) => e.target_node_id === id)
        .map((e) => ({ edge: e, node: this.getNode(e.source_node_id) })),
      children: edges
        .filter((e) => e.source_node_id === id)
        .map((e) => ({ edge: e, node: this.getNode(e.target_node_id) })),
      sources: this.listSources(id),
    };
  }

  listSources(nodeId: string): MindSource[] {
    return this.db
      .prepare('SELECT * FROM sources WHERE node_id = ? ORDER BY created_at, id')
      .all(nodeId) as MindSource[];
  }

  similarNodes(mapId: string, title: string, excludeId?: string): SimilarNode[] {
    const nodes = this.db.prepare('SELECT * FROM nodes WHERE map_id = ?').all(mapId).map(toNode);
    return findSimilar(nodes, title, excludeId);
  }

  private placeNew(mapId: string, parentId?: string): { x: number; y: number } {
    const nodes = this.db.prepare('SELECT id, x, y FROM nodes WHERE map_id = ?').all(mapId) as {
      id: string;
      x: number;
      y: number;
    }[];
    let x = 0;
    let y = 0;
    if (parentId) {
      const parent = nodes.find((n) => n.id === parentId);
      if (parent) {
        const kids = this.db
          .prepare('SELECT target_node_id AS id FROM edges WHERE source_node_id = ?')
          .all(parentId) as { id: string }[];
        const kidNodes = nodes.filter((n) => kids.some((k) => k.id === n.id));
        x = parent.x + 300;
        y = kidNodes.length ? Math.max(...kidNodes.map((k) => k.y)) + 92 : parent.y;
      }
    } else if (nodes.length) {
      y = Math.max(...nodes.map((n) => n.y)) + 140;
    }
    // Nudge down until the slot is free.
    while (nodes.some((n) => Math.abs(n.x - x) < 120 && Math.abs(n.y - y) < 60)) y += 92;
    return { x, y };
  }

  createNode(mapId: string, input: NodeCreate, opts: CreateNodeOptions = {}): { node: MindNode; edge?: MindEdge } {
    this.getMap(mapId);
    const provenance = opts.provenance ?? input.provenance ?? 'user';
    if (opts.rejectDuplicates) {
      const dupes = this.similarNodes(mapId, input.title).filter(isDuplicate);
      if (dupes.length) {
        throw new MindmapError('possible_duplicate', duplicateMessage(input.title, dupes), duplicateDetails(dupes));
      }
    }
    if (input.parent_id) {
      const parent = this.getNode(input.parent_id);
      if (parent.map_id !== mapId) throw new MindmapError('invalid', 'parent_id belongs to a different map');
    }
    const pos =
      input.x !== undefined && input.y !== undefined
        ? { x: input.x, y: input.y }
        : this.placeNew(mapId, input.parent_id);
    const t = now();
    const id = newId('n');
    return this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO nodes (id, map_id, title, summary, notes, tags, questions, status, provenance, x, y, collapsed, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,0,?,?)`,
        )
        .run(
          id,
          mapId,
          input.title,
          input.summary ?? '',
          input.notes ?? '',
          JSON.stringify(dedupe(input.tags ?? [])),
          JSON.stringify(dedupe(input.questions ?? [])),
          input.status ?? 'seed',
          provenance,
          pos.x,
          pos.y,
          t,
          t,
        );
      let edge: MindEdge | undefined;
      if (input.parent_id) {
        const [from, to] = input.direction === 'to_parent' ? [id, input.parent_id] : [input.parent_id, id];
        edge = this.createEdge(
          mapId,
          { source_node_id: from, target_node_id: to, label: input.relationship ?? '' },
          provenance,
        ).edge;
      }
      this.touchMap(mapId);
      return { node: this.getNode(id), edge };
    })();
  }

  updateNode(id: string, patch: NodeUpdate): MindNode {
    const cur = this.getNode(id);
    const next = {
      title: patch.title ?? cur.title,
      summary: patch.summary ?? cur.summary,
      notes: patch.notes ?? cur.notes,
      tags: patch.tags ? dedupe(patch.tags) : cur.tags,
      questions: patch.questions ? dedupe(patch.questions) : cur.questions,
      status: patch.status ?? cur.status,
      x: patch.x ?? cur.x,
      y: patch.y ?? cur.y,
      collapsed: patch.collapsed ?? cur.collapsed,
    };
    this.db
      .prepare(
        `UPDATE nodes SET title=?, summary=?, notes=?, tags=?, questions=?, status=?, x=?, y=?, collapsed=?, updated_at=? WHERE id=?`,
      )
      .run(
        next.title,
        next.summary,
        next.notes,
        JSON.stringify(next.tags),
        JSON.stringify(next.questions),
        next.status,
        next.x,
        next.y,
        next.collapsed ? 1 : 0,
        now(),
        id,
      );
    this.touchMap(cur.map_id);
    return this.getNode(id);
  }

  /** Bulk position save (drag / auto-layout). Doesn't bump updated_at: moving isn't editing. */
  setPositions(mapId: string, positions: { id: string; x: number; y: number }[]): void {
    const stmt = this.db.prepare('UPDATE nodes SET x=?, y=? WHERE id=? AND map_id=?');
    this.db.transaction(() => {
      for (const p of positions) stmt.run(p.x, p.y, p.id, mapId);
    })();
  }

  /** Append to list-like fields without clobbering what is there. */
  appendToNode(id: string, add: { tags?: string[]; questions?: string[]; notes?: string }): MindNode {
    const cur = this.getNode(id);
    return this.updateNode(id, {
      tags: add.tags ? [...cur.tags, ...add.tags] : undefined,
      questions: add.questions ? [...cur.questions, ...add.questions] : undefined,
      notes: add.notes ? [cur.notes.trimEnd(), add.notes.trim()].filter(Boolean).join('\n\n') : undefined,
    });
  }

  /** Describes what deleting `id` would remove, without removing it. */
  previewDeleteNode(id: string): DeletedSnapshot {
    const node = this.getNode(id);
    return {
      map_id: node.map_id,
      nodes: [node],
      edges: this.db
        .prepare('SELECT * FROM edges WHERE source_node_id = ? OR target_node_id = ?')
        .all(id, id) as MindEdge[],
      sources: this.listSources(id),
    };
  }

  deleteNode(id: string): DeletedSnapshot {
    const snap = this.previewDeleteNode(id);
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM nodes WHERE id = ?').run(id); // edges + sources cascade
      this.touchMap(snap.map_id);
    })();
    return snap;
  }

  /** Re-insert a snapshot returned by a delete (undo). Missing map → error; existing rows are left alone. */
  restore(snap: DeletedSnapshot): void {
    this.getMap(snap.map_id);
    this.db.transaction(() => {
      for (const n of snap.nodes) {
        this.db
          .prepare(
            `INSERT OR IGNORE INTO nodes (id, map_id, title, summary, notes, tags, questions, status, provenance, x, y, collapsed, created_at, updated_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .run(
            n.id,
            n.map_id,
            n.title,
            n.summary,
            n.notes,
            JSON.stringify(n.tags),
            JSON.stringify(n.questions),
            n.status,
            n.provenance,
            n.x,
            n.y,
            n.collapsed ? 1 : 0,
            n.created_at,
            n.updated_at,
          );
      }
      for (const e of snap.edges) {
        const ok = (nid: string) => this.db.prepare('SELECT 1 FROM nodes WHERE id = ?').get(nid);
        if (!ok(e.source_node_id) || !ok(e.target_node_id)) continue;
        this.db
          .prepare(
            'INSERT OR IGNORE INTO edges (id, map_id, source_node_id, target_node_id, label, provenance, created_at) VALUES (?,?,?,?,?,?,?)',
          )
          .run(e.id, e.map_id, e.source_node_id, e.target_node_id, e.label, e.provenance, e.created_at);
      }
      for (const s of snap.sources) {
        if (!this.db.prepare('SELECT 1 FROM nodes WHERE id = ?').get(s.node_id)) continue;
        this.db
          .prepare(
            'INSERT OR IGNORE INTO sources (id, node_id, title, url, notes, provenance, created_at) VALUES (?,?,?,?,?,?,?)',
          )
          .run(s.id, s.node_id, s.title, s.url, s.notes, s.provenance, s.created_at);
      }
      this.touchMap(snap.map_id);
    })();
  }

  /* ───────────── edges ───────────── */

  getEdge(id: string): MindEdge {
    const row = this.db.prepare('SELECT * FROM edges WHERE id = ?').get(id) as MindEdge | undefined;
    if (!row) throw new MindmapError('not_found', `Edge "${id}" not found`);
    return row;
  }

  /** Idempotent: connecting two already-connected nodes returns the existing edge. */
  createEdge(mapId: string, input: EdgeCreate, provenance: Provenance = 'user'): { edge: MindEdge; created: boolean } {
    if (input.source_node_id === input.target_node_id)
      throw new MindmapError('invalid', 'A node cannot connect to itself');
    const a = this.getNode(input.source_node_id);
    const b = this.getNode(input.target_node_id);
    if (a.map_id !== mapId || b.map_id !== mapId)
      throw new MindmapError('invalid', 'Both nodes must be in the same map');
    const existing = this.db
      .prepare(
        'SELECT * FROM edges WHERE (source_node_id = ? AND target_node_id = ?) OR (source_node_id = ? AND target_node_id = ?)',
      )
      .get(a.id, b.id, b.id, a.id) as MindEdge | undefined;
    if (existing) return { edge: existing, created: false };
    const id = newId('e');
    this.db
      .prepare(
        'INSERT INTO edges (id, map_id, source_node_id, target_node_id, label, provenance, created_at) VALUES (?,?,?,?,?,?,?)',
      )
      .run(id, mapId, a.id, b.id, input.label ?? '', input.provenance ?? provenance, now());
    this.touchMap(mapId);
    return { edge: this.getEdge(id), created: true };
  }

  updateEdge(id: string, label: string): MindEdge {
    const e = this.getEdge(id);
    this.db.prepare('UPDATE edges SET label = ? WHERE id = ?').run(label, id);
    this.touchMap(e.map_id);
    return this.getEdge(id);
  }

  deleteEdge(id: string): MindEdge {
    const e = this.getEdge(id);
    this.db.prepare('DELETE FROM edges WHERE id = ?').run(id);
    this.touchMap(e.map_id);
    return e;
  }

  /* ───────────── sources ───────────── */

  /** Adding the same URL to a node twice returns the existing source. */
  addSource(
    nodeId: string,
    input: SourceCreate,
    provenance: Provenance = 'user',
  ): { source: MindSource; created: boolean } {
    input = sourceCreate.parse(input);
    const node = this.getNode(nodeId);
    const dupe = this.listSources(nodeId).find((s) => s.url === input.url);
    if (dupe) return { source: dupe, created: false };
    const id = newId('s');
    this.db
      .prepare('INSERT INTO sources (id, node_id, title, url, notes, provenance, created_at) VALUES (?,?,?,?,?,?,?)')
      .run(id, nodeId, input.title ?? '', input.url, input.notes ?? '', input.provenance ?? provenance, now());
    this.touchMap(node.map_id);
    return { source: this.db.prepare('SELECT * FROM sources WHERE id = ?').get(id) as MindSource, created: true };
  }

  updateSource(id: string, patch: SourceUpdate): MindSource {
    const cur = this.db.prepare('SELECT * FROM sources WHERE id = ?').get(id) as MindSource | undefined;
    if (!cur) throw new MindmapError('not_found', `Source "${id}" not found`);
    this.db
      .prepare('UPDATE sources SET url=?, title=?, notes=? WHERE id=?')
      .run(patch.url ?? cur.url, patch.title ?? cur.title, patch.notes ?? cur.notes, id);
    this.touchMap(this.getNode(cur.node_id).map_id);
    return this.db.prepare('SELECT * FROM sources WHERE id = ?').get(id) as MindSource;
  }

  deleteSource(id: string): MindSource {
    const cur = this.db.prepare('SELECT * FROM sources WHERE id = ?').get(id) as MindSource | undefined;
    if (!cur) throw new MindmapError('not_found', `Source "${id}" not found`);
    this.db.prepare('DELETE FROM sources WHERE id = ?').run(id);
    this.touchMap(this.getNode(cur.node_id).map_id);
    return cur;
  }

  /* ───────────── search ───────────── */

  /** Every query word must appear somewhere in title/summary/notes/tags. Title hits rank highest. */
  search(query: string, opts: { mapId?: string; limit?: number } = {}): SearchHit[] {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const rows = opts.mapId
      ? this.db
          .prepare(
            'SELECT n.*, m.title AS map_title FROM nodes n JOIN maps m ON m.id = n.map_id WHERE n.map_id = ? AND m.archived = 0',
          )
          .all(opts.mapId)
      : this.db
          .prepare('SELECT n.*, m.title AS map_title FROM nodes n JOIN maps m ON m.id = n.map_id WHERE m.archived = 0')
          .all();
    const hits: SearchHit[] = [];
    for (const r of rows as Array<Record<string, unknown> & { map_title: string }>) {
      const { map_title, ...rest } = r;
      const node = toNode(rest);
      const fields = {
        title: node.title.toLowerCase(),
        summary: node.summary.toLowerCase(),
        notes: node.notes.toLowerCase(),
        tags: node.tags.join(' ').toLowerCase(),
      };
      let score = 0;
      const matched = new Set<'title' | 'summary' | 'notes' | 'tags'>();
      let ok = true;
      for (const w of words) {
        let best = 0;
        if (fields.title === w) best = 12;
        else if (fields.title.startsWith(w)) best = 9;
        else if (fields.title.includes(w)) best = 7;
        if (fields.tags.includes(w)) {
          best = Math.max(best, 4);
          matched.add('tags');
        }
        if (fields.summary.includes(w)) {
          best = Math.max(best, 3);
          matched.add('summary');
        }
        if (fields.notes.includes(w)) {
          best = Math.max(best, 1);
          matched.add('notes');
        }
        if (fields.title.includes(w)) matched.add('title');
        if (!best) {
          ok = false;
          break;
        }
        score += best;
      }
      if (!ok) continue;
      hits.push({ node, map_title, score, matched: [...matched], snippet: snippetFor(node, words) });
    }
    return hits
      .sort((a, b) => b.score - a.score || b.node.updated_at.localeCompare(a.node.updated_at))
      .slice(0, opts.limit ?? 30);
  }

  /* ───────────── branches & context ───────────── */

  getBranch(
    nodeId: string,
    opts: { direction?: 'descendants' | 'ancestors'; depth?: number } = {},
  ): MapGraph & { root_id: string } {
    const root = this.getNode(nodeId);
    const graph = this.getGraph(root.map_id);
    const ids =
      opts.direction === 'ancestors'
        ? pathToRoot(nodeId, graph.edges)
        : branchIds(nodeId, graph.edges, opts.depth ?? Infinity);
    return { ...subgraph(graph, ids), root_id: nodeId };
  }

  /** Resolve a selection and render it for an AI. `nodeIds` wins over `rootId`. */
  getContext(
    mapId: string,
    sel: { nodeIds?: string[]; rootId?: string; includeDescendants?: boolean; depth?: number },
    format: ContextFormat = 'markdown',
  ): { text: string; node_count: number } {
    const graph = this.getGraph(mapId);
    const known = new Set(graph.nodes.map((n) => n.id));
    let ids = sel.nodeIds ?? [];
    if (!ids.length && sel.rootId) {
      ids = sel.includeDescendants === false ? [sel.rootId] : branchIds(sel.rootId, graph.edges, sel.depth ?? Infinity);
    }
    const missing = ids.filter((i) => !known.has(i));
    if (missing.length) throw new MindmapError('not_found', `Node(s) not found in this map: ${missing.join(', ')}`);
    if (!ids.length) throw new MindmapError('invalid', 'Select at least one node (node_ids or root_id)');
    return { text: buildContext(graph, ids, format), node_count: ids.length };
  }
}

export function subgraph(graph: MapGraph, ids: string[]): MapGraph {
  const set = new Set(ids);
  return {
    map: graph.map,
    nodes: ids.map((i) => graph.nodes.find((n) => n.id === i)).filter((n): n is MindNode => !!n),
    edges: graph.edges.filter((e) => set.has(e.source_node_id) && set.has(e.target_node_id)),
    sources: graph.sources.filter((s) => set.has(s.node_id)),
  };
}

function snippetFor(node: MindNode, words: string[]): string {
  const hay = [node.summary, node.notes].find((t) => words.some((w) => t.toLowerCase().includes(w))) ?? node.summary;
  if (!hay) return '';
  const flat = hay.replace(/\s+/g, ' ').trim();
  const at = Math.max(0, flat.toLowerCase().indexOf(words.find((w) => flat.toLowerCase().includes(w)) ?? ''));
  const start = Math.max(0, at - 40);
  return (start > 0 ? '…' : '') + flat.slice(start, start + 120) + (flat.length > start + 120 ? '…' : '');
}
