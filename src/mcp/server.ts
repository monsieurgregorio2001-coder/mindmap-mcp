import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { NODE_STATUSES, MindmapError, type MindNode } from '../core/types.js';
import { sourceCreate } from '../core/schemas.js';
import type { Store } from '../core/store.js';

type ToolResult = {
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

const ok = (data: Record<string, unknown>): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  structuredContent: data,
});
const fail = (err: unknown): ToolResult => {
  const data =
    err instanceof MindmapError
      ? { error: err.message, code: err.code, ...(err.details ? { details: err.details } : {}) }
      : err instanceof z.ZodError
        ? { error: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '), code: 'invalid' }
        : { error: err instanceof Error ? err.message : String(err), code: 'internal' };
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], isError: true };
};
/** Wrap a handler so thrown domain errors become structured tool errors instead of protocol errors. */
const tool =
  <A>(fn: (args: A) => Record<string, unknown>) =>
  async (args: A): Promise<ToolResult> => {
    try {
      return ok(fn(args));
    } catch (e) {
      return fail(e);
    }
  };

/** Compact node view: no long notes unless asked, so maps stay cheap to read. */
const brief = (n: MindNode, withNotes = false) => ({
  id: n.id,
  title: n.title,
  summary: n.summary,
  tags: n.tags,
  status: n.status,
  provenance: n.provenance,
  open_questions: n.questions,
  ...(withNotes ? { notes: n.notes } : { has_notes: n.notes.trim().length > 0 }),
});

const mapRef = z.string().describe('Map id, or its title (exact or unique partial match)');

export function createMcpServer(store: Store): McpServer {
  const server = new McpServer(
    { name: 'living-mindmap', version: '0.1.0' },
    {
      instructions: [
        "Living Mindmap is the user's persistent knowledge graph (maps of nodes connected by labelled edges).",
        'To add knowledge: list_maps → search_nodes / get_map to see what exists → get_node on the closest match → ',
        'update_node (prefer append_notes / add_tags / add_questions over replacing) or create_node with parent_id.',
        'create_node refuses near-duplicate titles; read the candidates and update or connect instead of forcing.',
        'Keep summaries to one or two sentences; put detail in notes. Attach evidence with add_source.',
        'Everything you add is marked provenance "ai". delete_node needs confirm=true; show the user the preview first.',
      ].join(' '),
    },
  );

  const resolve = (map: string) => store.resolveMap(map);

  server.registerTool(
    'list_maps',
    {
      title: 'List maps',
      description:
        "List the user's mindmaps (topics) with node counts and last-updated time. Start here to find the right map.",
      inputSchema: { include_archived: z.boolean().optional() },
      annotations: { readOnlyHint: true },
    },
    tool(({ include_archived }) => ({
      maps: store.listMaps({ includeArchived: include_archived }).map((m) => ({
        id: m.id,
        title: m.title,
        description: m.description,
        node_count: m.node_count,
        updated_at: m.updated_at,
        archived: m.archived,
      })),
    })),
  );

  server.registerTool(
    'get_map',
    {
      title: 'Get map',
      description:
        'Read a whole map as compact nodes (no notes by default) and edges. Use get_node or get_branch for detail. Large maps: prefer search_nodes first.',
      inputSchema: { map: mapRef, include_notes: z.boolean().optional() },
      annotations: { readOnlyHint: true },
    },
    tool(({ map, include_notes }) => {
      const g = store.getGraph(resolve(map).id);
      return {
        map: { id: g.map.id, title: g.map.title, description: g.map.description },
        nodes: g.nodes.map((n) => brief(n, include_notes)),
        edges: g.edges.map((e) => ({ id: e.id, from: e.source_node_id, to: e.target_node_id, label: e.label })),
      };
    }),
  );

  server.registerTool(
    'search_nodes',
    {
      title: 'Search nodes',
      description:
        'Full-text search over node titles, summaries, notes and tags. Omit `map` to search every map. Use before creating a node to see if the idea already exists.',
      inputSchema: {
        query: z.string().min(1),
        map: mapRef.optional(),
        limit: z.number().int().min(1).max(50).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    tool(({ query, map, limit }) => ({
      results: store.search(query, { mapId: map ? resolve(map).id : undefined, limit: limit ?? 15 }).map((h) => ({
        ...brief(h.node),
        map_id: h.node.map_id,
        map_title: h.map_title,
        matched: h.matched,
        snippet: h.snippet,
      })),
    })),
  );

  server.registerTool(
    'get_node',
    {
      title: 'Get node',
      description:
        'Read one node in full, with its parents, children (and edge labels) and sources. Use to inspect the neighbourhood before adding anything.',
      inputSchema: { node_id: z.string() },
      annotations: { readOnlyHint: true },
    },
    tool(({ node_id }) => {
      const c = store.getNodeContext(node_id);
      return {
        node: brief(c.node, true),
        parents: c.parents.map((p) => ({ edge_id: p.edge.id, label: p.edge.label, ...brief(p.node) })),
        children: c.children.map((p) => ({ edge_id: p.edge.id, label: p.edge.label, ...brief(p.node) })),
        sources: c.sources.map((s) => ({ id: s.id, title: s.title, url: s.url, notes: s.notes })),
      };
    }),
  );

  server.registerTool(
    'create_node',
    {
      title: 'Create node',
      description:
        'Add a concept. Pass parent_id to connect it to an existing node in one step (map is then inferred). Refuses near-duplicate titles unless allow_duplicate=true. Returns similar existing nodes so you can connect rather than duplicate.',
      inputSchema: {
        map: mapRef.optional().describe('Required unless parent_id is given'),
        title: z.string().min(1).max(300),
        summary: z.string().max(2000).optional().describe('One or two sentences'),
        notes: z.string().optional().describe('Markdown detail'),
        tags: z.array(z.string()).optional(),
        questions: z.array(z.string()).optional().describe('Open questions / unresolved items'),
        status: z.enum(NODE_STATUSES).optional(),
        parent_id: z.string().optional(),
        relationship: z.string().max(200).optional().describe('Edge label, e.g. "is a kind of", "enables"'),
        direction: z
          .enum(['from_parent', 'to_parent'])
          .optional()
          .describe('Edge direction; default parent → new node'),
        allow_duplicate: z.boolean().optional(),
      },
    },
    tool((a) => {
      let mapId: string;
      if (a.parent_id) {
        mapId = store.getNode(a.parent_id).map_id;
        if (a.map && resolve(a.map).id !== mapId)
          throw new MindmapError('invalid', 'parent_id is not in the given map');
      } else if (a.map) {
        mapId = resolve(a.map).id;
      } else {
        throw new MindmapError('invalid', 'Provide `map` or `parent_id`');
      }
      const { allow_duplicate, map: _map, ...input } = a;
      void _map;
      const { node, edge } = store.createNode(mapId, input, { provenance: 'ai', rejectDuplicates: !allow_duplicate });
      const similar = store
        .similarNodes(mapId, node.title, node.id)
        .slice(0, 5)
        .map((s) => ({ id: s.node.id, title: s.node.title, score: s.score, why: s.reason }));
      return {
        created: true,
        node: brief(node),
        edge: edge ?? null,
        ...(similar.length ? { similar_nodes: similar } : {}),
      };
    }),
  );

  server.registerTool(
    'update_node',
    {
      title: 'Update node',
      description:
        "Change a node. `title`, `summary`, `notes`, `tags`, `questions` REPLACE the field; prefer the append_notes / add_tags / add_questions variants to enrich without overwriting the user's writing.",
      inputSchema: {
        node_id: z.string(),
        title: z.string().min(1).max(300).optional(),
        summary: z.string().max(2000).optional(),
        notes: z.string().optional(),
        tags: z.array(z.string()).optional(),
        questions: z.array(z.string()).optional(),
        status: z.enum(NODE_STATUSES).optional(),
        append_notes: z.string().optional(),
        add_tags: z.array(z.string()).optional(),
        add_questions: z.array(z.string()).optional(),
      },
      annotations: { idempotentHint: false },
    },
    tool(({ node_id, append_notes, add_tags, add_questions, ...patch }) => {
      store.getNode(node_id);
      let node = Object.keys(patch).length ? store.updateNode(node_id, patch) : store.getNode(node_id);
      if (append_notes || add_tags || add_questions) {
        node = store.appendToNode(node_id, { notes: append_notes, tags: add_tags, questions: add_questions });
      }
      return { updated: true, node: brief(node, true) };
    }),
  );

  server.registerTool(
    'delete_node',
    {
      title: 'Delete node',
      description:
        'Delete a node with its edges and sources. DESTRUCTIVE: call first without confirm to get a preview of what would be removed, show it to the user, then call again with confirm=true.',
      inputSchema: { node_id: z.string(), confirm: z.boolean().optional() },
      annotations: { destructiveHint: true },
    },
    tool(({ node_id, confirm }) => {
      if (!confirm) {
        const p = store.previewDeleteNode(node_id);
        return {
          deleted: false,
          preview: {
            node: brief(p.nodes[0]),
            edges_removed: p.edges.length,
            sources_removed: p.sources.length,
          },
          next: 'Call delete_node again with confirm=true to proceed.',
        };
      }
      const snap = store.deleteNode(node_id);
      return {
        deleted: true,
        node: brief(snap.nodes[0]),
        edges_removed: snap.edges.length,
        sources_removed: snap.sources.length,
      };
    }),
  );

  server.registerTool(
    'create_edge',
    {
      title: 'Connect nodes',
      description:
        'Connect two existing nodes in the same map. Idempotent: returns the existing edge if they are already connected.',
      inputSchema: { source_node_id: z.string(), target_node_id: z.string(), label: z.string().max(200).optional() },
    },
    tool(({ source_node_id, target_node_id, label }) => {
      const mapId = store.getNode(source_node_id).map_id;
      const { edge, created } = store.createEdge(mapId, { source_node_id, target_node_id, label }, 'ai');
      return { created, edge };
    }),
  );

  server.registerTool(
    'delete_edge',
    {
      title: 'Disconnect nodes',
      description: 'Remove one connection (the nodes are kept).',
      inputSchema: { edge_id: z.string() },
      annotations: { destructiveHint: true },
    },
    tool(({ edge_id }) => ({ deleted: true, edge: store.deleteEdge(edge_id) })),
  );

  server.registerTool(
    'get_branch',
    {
      title: 'Get branch',
      description:
        'A node plus its descendants (default) or its ancestors up to the root, as a connected subgraph. depth limits descendants.',
      inputSchema: {
        node_id: z.string(),
        direction: z.enum(['descendants', 'ancestors']).optional(),
        depth: z.number().int().min(1).max(20).optional(),
        include_notes: z.boolean().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    tool(({ node_id, direction, depth, include_notes }) => {
      const b = store.getBranch(node_id, { direction, depth });
      return {
        map: { id: b.map.id, title: b.map.title },
        root_id: b.root_id,
        nodes: b.nodes.map((n) => brief(n, include_notes)),
        edges: b.edges.map((e) => ({ id: e.id, from: e.source_node_id, to: e.target_node_id, label: e.label })),
        sources: b.sources.map((s) => ({ node_id: s.node_id, title: s.title, url: s.url })),
      };
    }),
  );

  server.registerTool(
    'add_source',
    {
      title: 'Add source',
      description:
        'Attach a URL (with optional title/notes) to a node as evidence. Same URL on the same node is not duplicated.',
      inputSchema: {
        node_id: z.string(),
        url: sourceCreate.shape.url,
        title: z.string().optional(),
        notes: z.string().optional(),
      },
    },
    tool(({ node_id, url, title, notes }) => {
      const { source, created } = store.addSource(node_id, { url, title, notes }, 'ai');
      return { created, source };
    }),
  );

  server.registerTool(
    'get_ai_context',
    {
      title: 'Get AI context',
      description:
        'Render part of a map as clean context (markdown or json). Give node_ids, or a root_id (with its descendants, optionally depth-limited). Same output as the app\'s "Copy as AI Context".',
      inputSchema: {
        map: mapRef.optional().describe('Optional when root_id or node_ids are given'),
        node_ids: z.array(z.string()).optional(),
        root_id: z.string().optional(),
        include_descendants: z.boolean().optional().describe('With root_id; default true'),
        depth: z.number().int().min(1).max(20).optional(),
        format: z.enum(['markdown', 'json']).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    tool((a) => {
      const anchor = a.node_ids?.[0] ?? a.root_id;
      const mapId = a.map ? resolve(a.map).id : anchor ? store.getNode(anchor).map_id : undefined;
      if (!mapId) throw new MindmapError('invalid', 'Provide `map`, `node_ids` or `root_id`');
      const { text, node_count } = store.getContext(
        mapId,
        { nodeIds: a.node_ids, rootId: a.root_id, includeDescendants: a.include_descendants, depth: a.depth },
        a.format ?? 'markdown',
      );
      return { format: a.format ?? 'markdown', node_count, context: text };
    }),
  );

  return server;
}
