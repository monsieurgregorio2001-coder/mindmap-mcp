import { childrenMap, parentsMap } from '../shared/graph.js';
import type { MapGraph, MindEdge, MindNode, MindSource } from './types.js';

export type ContextFormat = 'markdown' | 'json';

interface Selection {
  nodes: MindNode[]; // ordered: roots first, then breadth-first along selected edges
  edges: MindEdge[]; // edges with both ends inside the selection
  sources: MindSource[];
}

function select(graph: MapGraph, ids: string[]): Selection {
  const wanted = new Set(ids);
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const picked = graph.nodes.filter((n) => wanted.has(n.id));
  const edges = graph.edges.filter((e) => wanted.has(e.source_node_id) && wanted.has(e.target_node_id));
  const kids = childrenMap(edges);
  const parents = parentsMap(edges);

  const ordered: MindNode[] = [];
  const seen = new Set<string>();
  const visit = (start: string) => {
    const queue = [start];
    while (queue.length) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const n = byId.get(id);
      if (n) ordered.push(n);
      queue.push(...(kids.get(id) ?? []));
    }
  };
  // Keep the caller's order for roots so "Root → Child → Leaf" reads as selected.
  const callerOrder = ids.filter((id) => wanted.has(id));
  for (const id of callerOrder) if (!parents.get(id)?.length) visit(id);
  for (const id of callerOrder) visit(id); // cycles / leftovers
  const sources = graph.sources.filter((s) => wanted.has(s.node_id));
  return { nodes: ordered.length ? ordered : picked, edges, sources };
}

function contextTitle(sel: Selection): string {
  const { nodes, edges } = sel;
  if (nodes.length === 0) return 'Empty selection';
  const kids = childrenMap(edges);
  const parents = parentsMap(edges);
  const isChain =
    nodes.length > 1 &&
    nodes.every((n) => (kids.get(n.id)?.length ?? 0) <= 1 && (parents.get(n.id)?.length ?? 0) <= 1) &&
    edges.length === nodes.length - 1;
  if (isChain) return nodes.map((n) => n.title).join(' → ');
  const roots = nodes.filter((n) => !parents.get(n.id)?.length);
  const head = (roots.length ? roots : nodes.slice(0, 1)).map((n) => n.title);
  const shown = head.slice(0, 3).join(', ');
  const rest = nodes.length - head.slice(0, 3).length;
  return rest > 0 ? `${shown} (+${rest} related node${rest === 1 ? '' : 's'})` : shown;
}

function oneLine(s: string): string {
  return s.replace(/\s*\n\s*/g, ' ').trim();
}

export function buildContext(graph: MapGraph, nodeIds: string[], format: ContextFormat = 'markdown'): string {
  const sel = select(graph, nodeIds);
  const title = contextTitle(sel);
  const titleOf = new Map(sel.nodes.map((n) => [n.id, n.title]));
  const sourcesByNode = new Map<string, MindSource[]>();
  for (const s of sel.sources) sourcesByNode.set(s.node_id, [...(sourcesByNode.get(s.node_id) ?? []), s]);

  if (format === 'json') {
    return JSON.stringify(
      {
        context: title,
        map: { id: graph.map.id, title: graph.map.title },
        exported_at: new Date().toISOString(),
        nodes: sel.nodes.map((n) => ({
          id: n.id,
          title: n.title,
          summary: n.summary,
          notes: n.notes,
          tags: n.tags,
          status: n.status,
          provenance: n.provenance,
          open_questions: n.questions,
          sources: (sourcesByNode.get(n.id) ?? []).map((s) => ({ title: s.title, url: s.url, notes: s.notes })),
        })),
        relationships: sel.edges.map((e) => ({
          from: e.source_node_id,
          to: e.target_node_id,
          from_title: titleOf.get(e.source_node_id),
          to_title: titleOf.get(e.target_node_id),
          label: e.label,
        })),
      },
      null,
      2,
    );
  }

  const lines: string[] = [`# Context: ${title}`, ''];
  lines.push(`Map: ${graph.map.title}${graph.map.description ? ` — ${oneLine(graph.map.description)}` : ''}`, '');
  const incoming = new Map<string, MindEdge[]>();
  for (const e of sel.edges) incoming.set(e.target_node_id, [...(incoming.get(e.target_node_id) ?? []), e]);

  for (const n of sel.nodes) {
    lines.push(`## ${n.title}`);
    for (const e of incoming.get(n.id) ?? []) {
      const label = e.label ? ` (${e.label})` : '';
      lines.push(`Relationship: ${titleOf.get(e.source_node_id)} → ${n.title}${label}`);
    }
    if (n.summary) lines.push(`Summary: ${oneLine(n.summary)}`);
    if (n.tags.length) lines.push(`Tags: ${n.tags.join(', ')}`);
    if (n.status !== 'seed') lines.push(`Status: ${n.status}`);
    if (n.provenance !== 'user') lines.push(`Provenance: ${n.provenance === 'ai' ? 'AI-added' : 'source-derived'}`);
    if (n.notes.trim()) lines.push('Notes:', n.notes.trim());
    lines.push('');
  }

  const questions = sel.nodes.flatMap((n) => n.questions.map((q) => ({ node: n.title, q })));
  if (questions.length) {
    lines.push('## Open Questions');
    for (const { node, q } of questions) lines.push(`- ${q} _(${node})_`);
    lines.push('');
  }
  if (sel.sources.length) {
    lines.push('## Sources');
    for (const n of sel.nodes) {
      for (const s of sourcesByNode.get(n.id) ?? []) {
        const label = s.title ? `[${s.title}](${s.url})` : s.url;
        lines.push(`- ${label} _(${n.title})_${s.notes ? ` — ${oneLine(s.notes)}` : ''}`);
      }
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd() + '\n';
}
