/** Pure graph helpers shared by the server, MCP tools and the browser. */

export interface EdgeLike {
  source_node_id: string;
  target_node_id: string;
}
export interface NodeLike {
  id: string;
  collapsed?: boolean;
  created_at?: string;
}

export function childrenMap(edges: EdgeLike[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const e of edges) {
    const list = m.get(e.source_node_id);
    if (list) list.push(e.target_node_id);
    else m.set(e.source_node_id, [e.target_node_id]);
  }
  return m;
}

export function parentsMap(edges: EdgeLike[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const e of edges) {
    const list = m.get(e.target_node_id);
    if (list) list.push(e.source_node_id);
    else m.set(e.target_node_id, [e.source_node_id]);
  }
  return m;
}

/** The root plus everything reachable by following edges forward (depth-limited if given). */
export function branchIds(rootId: string, edges: EdgeLike[], maxDepth = Infinity): string[] {
  const kids = childrenMap(edges);
  const seen = new Set([rootId]);
  const order = [rootId];
  let frontier = [rootId];
  for (let depth = 0; depth < maxDepth && frontier.length; depth++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const c of kids.get(id) ?? []) {
        if (!seen.has(c)) {
          seen.add(c);
          order.push(c);
          next.push(c);
        }
      }
    }
    frontier = next;
  }
  return order;
}

/** The node and its ancestors (following the first parent each step), root first. */
export function pathToRoot(id: string, edges: EdgeLike[]): string[] {
  const parents = parentsMap(edges);
  const path = [id];
  const seen = new Set([id]);
  let cur = id;
  for (;;) {
    const p = (parents.get(cur) ?? []).find((x) => !seen.has(x));
    if (!p) break;
    path.unshift(p);
    seen.add(p);
    cur = p;
  }
  return path;
}

/** Ids hidden because an ancestor is collapsed. Nodes still reachable another way stay visible. */
export function hiddenByCollapse(nodes: NodeLike[], edges: EdgeLike[]): Set<string> {
  const collapsed = nodes.filter((n) => n.collapsed);
  if (collapsed.length === 0) return new Set();
  const kids = childrenMap(edges);
  const parents = parentsMap(edges);

  const shadowed = new Set<string>();
  for (const c of collapsed) {
    for (const id of branchIds(c.id, edges)) if (id !== c.id) shadowed.add(id);
  }
  // Anything reachable from an un-shadowed root without passing through a collapsed node stays visible.
  const collapsedIds = new Set(collapsed.map((n) => n.id));
  const roots = nodes.filter((n) => !parents.get(n.id)?.length);
  const reach = new Set<string>();
  const stack = roots.map((r) => r.id);
  while (stack.length) {
    const id = stack.pop()!;
    if (reach.has(id)) continue;
    reach.add(id);
    if (collapsedIds.has(id)) continue;
    for (const c of kids.get(id) ?? []) stack.push(c);
  }
  const hidden = new Set<string>();
  for (const id of shadowed) if (!reach.has(id)) hidden.add(id);
  return hidden;
}

export interface LayoutOptions {
  hSpacing?: number;
  vSpacing?: number;
}

/**
 * Left-to-right tidy tree. Builds a spanning forest (roots = nodes without parents, then
 * anything left over in cycles) and centres each parent on its children.
 */
export function layoutTree(
  nodes: NodeLike[],
  edges: EdgeLike[],
  { hSpacing = 300, vSpacing = 92 }: LayoutOptions = {},
): Map<string, { x: number; y: number }> {
  const ids = new Set(nodes.map((n) => n.id));
  const kids = childrenMap(edges.filter((e) => ids.has(e.source_node_id) && ids.has(e.target_node_id)));
  const parents = parentsMap(edges);
  const ordered = [...nodes].sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''));

  const visited = new Set<string>();
  const out = new Map<string, { x: number; y: number }>();
  let nextRow = 0;

  const place = (id: string, depth: number): number => {
    visited.add(id);
    const children = (kids.get(id) ?? []).filter((c) => !visited.has(c));
    // Claim children first so a node with two parents lays out under only one of them.
    for (const c of children) visited.add(c);
    let y: number;
    if (children.length === 0) {
      y = nextRow++ * vSpacing;
    } else {
      const ys = children.map((c) => place(c, depth + 1));
      y = (ys[0] + ys[ys.length - 1]) / 2;
    }
    out.set(id, { x: depth * hSpacing, y });
    return y;
  };

  const roots = ordered.filter((n) => !parents.get(n.id)?.length);
  for (const r of roots) if (!visited.has(r.id)) place(r.id, 0);
  for (const n of ordered) if (!visited.has(n.id)) place(n.id, 0);
  return out;
}
