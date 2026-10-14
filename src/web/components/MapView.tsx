import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type NodeChange,
} from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { branchIds, childrenMap, hiddenByCollapse, layoutTree, parentsMap, pathToRoot } from '../../shared/graph';
import type { DeletedSnapshot, MapGraph, MindNode } from '../../core/types';
import { api, ApiError, type NodePatch } from '../api';
import { useToast } from '../toast';
import { copyText, download, isTyping, slug } from '../util';
import { Back, Help, Logo, Panel, Plus } from './Icons';
import { Inspector, type InspectorActions } from './Inspector';
import { MindNodeView, type MindFlowNode } from './MindNodeView';
import { QuickAdd, type QuickState } from './QuickAdd';
import { SearchBox, type SearchHandle } from './SearchBox';
import { ThemeButton } from './ThemeButton';

const nodeTypes = { mind: MindNodeView };

export function MapView(props: { mapId: string; focus: string | null }) {
  return (
    <ReactFlowProvider>
      <Inner {...props} />
    </ReactFlowProvider>
  );
}

function Inner({ mapId, focus }: { mapId: string; focus: string | null }) {
  const toast = useToast();
  const rf = useReactFlow<MindFlowNode, Edge>();
  const [graph, setGraph] = useState<MapGraph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rfNodes, setRfNodes] = useState<MindFlowNode[]>([]);
  const [rfEdges, setRfEdges] = useState<Edge[]>([]);
  const [sel, setSel] = useState<{ nodes: string[]; edge: string | null }>({ nodes: [], edge: null });
  const [quick, setQuick] = useState<QuickState | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [focusSignal, setFocusSignal] = useState(0);
  const [help, setHelp] = useState(false);
  const [preview, setPreview] = useState<{ text: string; format: 'markdown' | 'json' } | null>(null);
  const [copyMenu, setCopyMenu] = useState(false);
  const [title, setTitle] = useState('');
  const [focusTick, setFocusTick] = useState(0);

  const graphRef = useRef<MapGraph | null>(null);
  graphRef.current = graph;
  const pending = useRef(0);
  const dragging = useRef(false);
  const pendingSelect = useRef<string[] | null>(null);
  const pendingFocus = useRef<string | null>(null);
  const searchRef = useRef<SearchHandle>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  /* ───────── data ───────── */

  const refresh = useCallback(async () => {
    try {
      const g = await api.getGraph(mapId);
      setError(null);
      setGraph((prev) => (prev && JSON.stringify(prev) === JSON.stringify(g) ? prev : g));
    } catch (e) {
      if (!graphRef.current) setError(e instanceof Error ? e.message : 'Failed to load');
    }
  }, [mapId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Pick up changes made elsewhere (MCP agents, another tab).
  useEffect(() => {
    const t = setInterval(() => {
      if (!document.hidden && pending.current === 0 && !dragging.current) void refresh();
    }, 3000);
    const onVis = () => !document.hidden && void refresh();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [refresh]);

  useEffect(() => {
    if (graph) setTitle(graph.map.title);
    if (graph) document.title = `${graph.map.title} · Living Mindmap`;
    return () => void (document.title = 'Living Mindmap');
  }, [graph?.map.title]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Run a write; keeps polling from clobbering it, toasts failures, never throws. */
  const run = useCallback(
    async <T,>(fn: () => Promise<T>, opts: { refresh?: boolean } = {}): Promise<T | undefined> => {
      pending.current++;
      try {
        const r = await fn();
        if (opts.refresh !== false) {
          pending.current--;
          await refresh();
          pending.current++;
        }
        return r;
      } catch (e) {
        toast(e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong', { tone: 'error' });
        await refresh();
        return undefined;
      } finally {
        pending.current--;
      }
    },
    [refresh, toast],
  );

  const localNode = useCallback((id: string, patch: Partial<MindNode>) => {
    setGraph((g) => g && { ...g, nodes: g.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) });
  }, []);

  /* ───────── graph → React Flow ───────── */

  const hidden = useMemo(() => (graph ? hiddenByCollapse(graph.nodes, graph.edges) : new Set<string>()), [graph]);

  const patchNode = useCallback(
    async (id: string, patch: NodePatch) => {
      localNode(id, patch as Partial<MindNode>);
      pending.current++;
      try {
        await api.updateNode(id, patch);
      } catch (e) {
        void refresh();
        throw e;
      } finally {
        pending.current--;
      }
    },
    [localNode, refresh],
  );

  const toggle = useCallback(
    (id: string) => {
      const n = graphRef.current?.nodes.find((x) => x.id === id);
      if (n) void patchNode(id, { collapsed: !n.collapsed }).catch((e) => toast(e.message, { tone: 'error' }));
    },
    [patchNode, toast],
  );

  useEffect(() => {
    if (!graph) return;
    const parents = parentsMap(graph.edges);
    const kids = childrenMap(graph.edges);
    const srcCount = new Map<string, number>();
    for (const s of graph.sources) srcCount.set(s.node_id, (srcCount.get(s.node_id) ?? 0) + 1);
    const forced = pendingSelect.current;
    pendingSelect.current = null;
    setRfNodes((prev) => {
      const old = new Map(prev.map((n) => [n.id, n]));
      return graph.nodes.map((n) => {
        const o = old.get(n.id);
        return {
          ...(o ?? {}),
          id: n.id,
          type: 'mind' as const,
          position: dragging.current && o ? o.position : { x: n.x, y: n.y },
          selected: forced ? forced.includes(n.id) : (o?.selected ?? false),
          hidden: hidden.has(n.id),
          data: {
            node: n,
            isRoot: !parents.get(n.id)?.length,
            childCount: kids.get(n.id)?.length ?? 0,
            hiddenCount: n.collapsed
              ? branchIds(n.id, graph.edges).filter((i) => i !== n.id && hidden.has(i)).length
              : 0,
            sourceCount: srcCount.get(n.id) ?? 0,
            onToggle: toggle,
          },
        };
      });
    });
    setRfEdges((prev) => {
      const old = new Map(prev.map((e) => [e.id, e]));
      return graph.edges.map((e) => ({
        id: e.id,
        source: e.source_node_id,
        target: e.target_node_id,
        label: e.label || undefined,
        selected: forced ? false : (old.get(e.id)?.selected ?? false),
        hidden: hidden.has(e.source_node_id) || hidden.has(e.target_node_id),
        markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
      }));
    });
  }, [graph, hidden, toggle]);

  const onNodesChange = useCallback((c: NodeChange<MindFlowNode>[]) => setRfNodes((ns) => applyNodeChanges(c, ns)), []);
  const onEdgesChange = useCallback((c: EdgeChange[]) => setRfEdges((es) => applyEdgeChanges(c, es)), []);

  const onSelectionChange = useCallback(({ nodes, edges }: { nodes: { id: string }[]; edges: { id: string }[] }) => {
    const n = nodes.map((x) => x.id);
    const e = nodes.length === 0 && edges.length === 1 ? edges[0].id : null;
    setSel((p) =>
      p.edge === e && p.nodes.length === n.length && p.nodes.every((id, i) => id === n[i]) ? p : { nodes: n, edge: e },
    );
  }, []);

  const selectIds = useCallback((ids: string[]) => {
    setRfNodes((ns) => ns.map((n) => (n.selected === ids.includes(n.id) ? n : { ...n, selected: ids.includes(n.id) })));
    setRfEdges((es) => es.map((e) => (e.selected ? { ...e, selected: false } : e)));
  }, []);

  /* ───────── navigation ───────── */

  const centerOn = useCallback(
    (id: string, opts: { onlyIfOffscreen?: boolean } = {}) => {
      const n = rf.getNode(id);
      if (!n) return;
      const w = n.measured?.width ?? 160;
      const h = n.measured?.height ?? 50;
      const vp = rf.getViewport();
      const box = canvasRef.current?.getBoundingClientRect();
      if (opts.onlyIfOffscreen && box) {
        const sx = n.position.x * vp.zoom + vp.x;
        const sy = n.position.y * vp.zoom + vp.y;
        if (sx > 40 && sy > 40 && sx + w * vp.zoom < box.width - 40 && sy + h * vp.zoom < box.height - 40) return;
      }
      void rf.setCenter(n.position.x + w / 2, n.position.y + h / 2, { zoom: Math.max(vp.zoom, 0.9), duration: 350 });
    },
    [rf],
  );

  useEffect(() => {
    const id = pendingFocus.current;
    if (!id) return;
    const n = rfNodes.find((x) => x.id === id);
    if (!n || n.hidden) return;
    pendingFocus.current = null;
    selectIds([id]);
    requestAnimationFrame(() => centerOn(id));
  }, [rfNodes, focusTick, selectIds, centerOn]);

  const focusNode = useCallback(
    async (id: string) => {
      const g = graphRef.current;
      if (!g) return;
      const collapsedAncestors = pathToRoot(id, g.edges).filter(
        (a) => a !== id && g.nodes.find((n) => n.id === a)?.collapsed,
      );
      pendingFocus.current = id;
      if (collapsedAncestors.length) {
        await run(() => Promise.all(collapsedAncestors.map((a) => api.updateNode(a, { collapsed: false }))));
      }
      setFocusTick((t) => t + 1);
    },
    [run],
  );

  const loaded = !!graph;
  useEffect(() => {
    if (loaded && focus) void focusNode(focus);
  }, [loaded, focus]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ───────── mutations ───────── */

  const addNode = useCallback(
    async (titleText: string, s: QuickState): Promise<MindNode | undefined> => {
      const res = await run(
        () =>
          api.createNode(mapId, {
            title: titleText,
            parent_id: s.parent?.id,
            relationship: s.parent && s.mode === 'related' ? 'related to' : undefined,
            x: s.at?.x,
            y: s.at?.y,
          }),
        { refresh: false },
      );
      if (!res) return undefined;
      pendingSelect.current = [res.node.id];
      setGraph((g) => g && { ...g, nodes: [...g.nodes, res.node], edges: res.edge ? [...g.edges, res.edge] : g.edges });
      requestAnimationFrame(() => centerOn(res.node.id, { onlyIfOffscreen: true }));
      return res.node;
    },
    [mapId, run, centerOn],
  );

  const deleteNodes = useCallback(
    async (ids: string[]) => {
      const snaps: DeletedSnapshot[] = [];
      for (const id of ids) {
        const s = await run(() => api.deleteNode(id), { refresh: false });
        if (s) snaps.push(s);
      }
      if (!snaps.length) return;
      const merged: DeletedSnapshot = {
        map_id: mapId,
        nodes: snaps.flatMap((s) => s.nodes),
        edges: [...new Map(snaps.flatMap((s) => s.edges).map((e) => [e.id, e])).values()],
        sources: snaps.flatMap((s) => s.sources),
      };
      await refresh();
      toast(snaps.length === 1 ? `Deleted “${snaps[0].nodes[0].title}”` : `Deleted ${snaps.length} nodes`, {
        action: { label: 'Undo', run: () => void run(() => api.restore(mapId, merged)) },
      });
    },
    [mapId, run, refresh, toast],
  );

  const deleteEdge = useCallback(
    async (id: string) => {
      const e = await run(() => api.deleteEdge(id));
      if (e) {
        toast('Connection removed', {
          action: {
            label: 'Undo',
            run: () => void run(() => api.createEdge(mapId, e.source_node_id, e.target_node_id, e.label)),
          },
        });
      }
    },
    [mapId, run, toast],
  );

  const connect = useCallback(
    async (from: string, to: string) => {
      await run(() => api.createEdge(mapId, from, to));
    },
    [mapId, run],
  );

  const tidy = useCallback(async () => {
    const g = graphRef.current;
    if (!g || !g.nodes.length) return;
    const pos = layoutTree(g.nodes, g.edges);
    const positions = [...pos].map(([id, p]) => ({ id, ...p }));
    setGraph((cur) => cur && { ...cur, nodes: cur.nodes.map((n) => ({ ...n, ...(pos.get(n.id) ?? {}) })) });
    await run(() => api.setPositions(mapId, positions), { refresh: false });
    requestAnimationFrame(() => void rf.fitView({ padding: 0.3, maxZoom: 1, duration: 400 }));
  }, [mapId, run, rf]);

  /* ───────── AI context ───────── */

  const fetchContext = useCallback(
    async (format: 'markdown' | 'json') => {
      if (!sel.nodes.length) {
        toast('Select a node or a branch first (B selects a branch)');
        return undefined;
      }
      return run(() => api.context(mapId, sel.nodes, format), { refresh: false });
    },
    [mapId, run, sel.nodes, toast],
  );

  const copyContext = useCallback(
    async (format: 'markdown' | 'json' = 'markdown') => {
      const r = await fetchContext(format);
      if (!r) return;
      const ok = await copyText(r.text);
      toast(
        ok
          ? `Copied ${r.node_count} ${r.node_count === 1 ? 'node' : 'nodes'} as ${format === 'json' ? 'JSON' : 'Markdown'} context`
          : 'Copy was blocked by the browser',
        ok ? {} : { tone: 'error' },
      );
    },
    [fetchContext, toast],
  );

  const showPreview = useCallback(
    async (format: 'markdown' | 'json' = 'markdown') => {
      const r = await fetchContext(format);
      if (r) setPreview({ text: r.text, format });
    },
    [fetchContext],
  );

  const downloadContext = useCallback(
    async (format: 'markdown' | 'json') => {
      const r = await fetchContext(format);
      if (!r) return;
      const first = graphRef.current?.nodes.find((n) => n.id === sel.nodes[0])?.title ?? 'context';
      download(
        `${slug(first)}-context.${format === 'json' ? 'json' : 'md'}`,
        r.text,
        format === 'json' ? 'application/json' : 'text/markdown',
      );
    },
    [fetchContext, sel.nodes],
  );

  /* ───────── selection helpers & keyboard ───────── */

  const selectBranch = useCallback(
    (id?: string) => {
      const g = graphRef.current;
      if (!g) return;
      const roots = id ? [id] : sel.nodes;
      selectIds([...new Set(roots.flatMap((r) => branchIds(r, g.edges)))]);
    },
    [sel.nodes, selectIds],
  );

  const selectPath = useCallback(() => {
    const g = graphRef.current;
    if (g && sel.nodes.length) selectIds([...new Set(sel.nodes.flatMap((n) => pathToRoot(n, g.edges)))]);
  }, [sel.nodes, selectIds]);

  const openQuick = useCallback(
    (mode: 'child' | 'related' | 'free', parent?: MindNode) => {
      const g = graphRef.current;
      if (!g) return;
      if (mode === 'free') {
        const box = canvasRef.current?.getBoundingClientRect();
        const at = box
          ? rf.screenToFlowPosition({ x: box.left + box.width / 2 - 80, y: box.top + box.height / 2 - 30 })
          : undefined;
        setQuick({ mode, parent: null, at: g.nodes.length ? at : { x: 0, y: 0 } });
      } else if (parent) setQuick({ mode, parent });
    },
    [rf],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) {
        if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'c' && !isTyping(e.target)) {
          e.preventDefault();
          void copyContext();
        }
        return;
      }
      const g = graphRef.current;
      if (!g) return;
      const one = sel.nodes.length === 1 ? g.nodes.find((n) => n.id === sel.nodes[0]) : undefined;
      const k = e.key;
      if (k === 'Escape') {
        if (preview) setPreview(null);
        else if (help) setHelp(false);
        else if (quick) setQuick(null);
        else selectIds([]);
      } else if (k === 'Tab' && !e.shiftKey) {
        e.preventDefault();
        if (one) openQuick('child', one);
        else if (!g.nodes.length) openQuick('free');
      } else if (k === 'Enter' && one) {
        e.preventDefault();
        const p = g.edges.find((x) => x.target_node_id === one.id);
        const parent = p && g.nodes.find((n) => n.id === p.source_node_id);
        if (parent) openQuick('child', parent);
        else openQuick('free');
      } else if (k.toLowerCase() === 'r' && one) {
        e.preventDefault();
        openQuick('related', one);
      } else if (k.toLowerCase() === 'n') {
        e.preventDefault();
        openQuick('free');
      } else if (k === 'Delete' || k === 'Backspace') {
        if (sel.nodes.length) void deleteNodes(sel.nodes);
        else if (sel.edge) void deleteEdge(sel.edge);
      } else if (k.toLowerCase() === 'c' && sel.nodes.length) {
        for (const id of sel.nodes) toggle(id);
      } else if (k.toLowerCase() === 'b' && sel.nodes.length) {
        selectBranch();
      } else if (k.toLowerCase() === 'f') {
        void rf.fitView({ padding: 0.3, maxZoom: 1, duration: 300 });
      } else if (k === '?') {
        setHelp((h) => !h);
      } else if (k.startsWith('Arrow') && one) {
        e.preventDefault();
        const kids = childrenMap(g.edges);
        const pars = parentsMap(g.edges);
        const byY = (ids: string[]) =>
          ids
            .filter((i) => !hidden.has(i))
            .sort((a, b) => (g.nodes.find((n) => n.id === a)?.y ?? 0) - (g.nodes.find((n) => n.id === b)?.y ?? 0));
        let target: string | undefined;
        if (k === 'ArrowRight') target = byY(kids.get(one.id) ?? [])[0];
        else if (k === 'ArrowLeft') target = (pars.get(one.id) ?? [])[0];
        else {
          const par = (pars.get(one.id) ?? [])[0];
          const sibs = par
            ? byY(kids.get(par) ?? [])
            : byY(g.nodes.filter((n) => !pars.get(n.id)?.length).map((n) => n.id));
          const i = sibs.indexOf(one.id);
          target = sibs[i + (k === 'ArrowDown' ? 1 : -1)];
        }
        if (target) {
          selectIds([target]);
          centerOn(target, { onlyIfOffscreen: true });
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    sel,
    quick,
    preview,
    help,
    hidden,
    openQuick,
    selectIds,
    selectBranch,
    deleteNodes,
    deleteEdge,
    toggle,
    copyContext,
    rf,
    centerOn,
  ]);

  /* ───────── inspector wiring ───────── */

  const actions: InspectorActions = useMemo(
    () => ({
      patchNode,
      addSource: async (nodeId, url, t) =>
        void (await run(() => api.addSource(nodeId, { url, title: t || undefined }))),
      deleteSource: async (id) => void (await run(() => api.deleteSource(id))),
      connect,
      deleteEdge,
      updateEdge: async (id, label) => void (await run(() => api.updateEdge(id, label))),
      deleteNodes,
      addChild: (n) => openQuick('child', n),
      selectBranch: (id) => selectBranch(id),
      focusNode: (id) => void focusNode(id),
      copyContext: () => void copyContext(),
      previewContext: () => void showPreview(),
    }),
    [patchNode, run, connect, deleteEdge, deleteNodes, openQuick, selectBranch, focusNode, copyContext, showPreview],
  );

  useEffect(() => {
    if (!copyMenu) return;
    const close = () => setCopyMenu(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [copyMenu]);

  /* ───────── render ───────── */

  if (error && !graph) {
    return (
      <div className="app">
        <header className="topbar">
          <a className="brand" href="#/">
            <Logo /> Living Mindmap
          </a>
        </header>
        <div className="page">
          <div className="empty">
            <h2>Can't open this map</h2>
            {error}
            <div className="row">
              <a className="btn" href="#/">
                Back to maps
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  }
  if (!graph)
    return (
      <div className="app">
        <header className="topbar">
          <a className="brand" href="#/">
            <Logo /> Living Mindmap
          </a>
        </header>
      </div>
    );

  const onConnect = (c: Connection) => c.source && c.target && void connect(c.source, c.target);
  const selCount = sel.nodes.length;

  return (
    <div className="app">
      <header className="topbar">
        <a className="icon-btn" href="#/" aria-label="All maps" title="All maps">
          <Back />
        </a>
        <input
          className="map-title-input"
          aria-label="Map title"
          value={title}
          size={Math.max(10, title.length)}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => {
            if (title.trim() && title !== graph.map.title)
              void run(() => api.updateMap(mapId, { title: title.trim() }));
            else setTitle(graph.map.title);
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        <span className="meta-line">{graph.nodes.length} nodes</span>
        <div className="spacer" />
        <SearchBox ref={searchRef} currentMapId={mapId} onPick={(id) => void focusNode(id)} />
        <button
          className="btn"
          onClick={() =>
            selCount === 1
              ? openQuick(
                  'related',
                  graph.nodes.find((n) => n.id === sel.nodes[0])!,
                )
              : openQuick('free')
          }
          title="Add idea (N)"
        >
          <Plus /> Add idea
        </button>
        <button className="btn ghost" onClick={() => void tidy()} title="Re-arrange the whole map as a tidy tree">
          Tidy
        </button>
        <button
          className="icon-btn"
          onClick={() => setHelp((h) => !h)}
          aria-label="Keyboard shortcuts"
          title="Shortcuts (?)"
        >
          <Help />
        </button>
        <ThemeButton />
        <button
          className="icon-btn"
          onClick={() => setInspectorOpen((o) => !o)}
          aria-label="Toggle inspector"
          title="Toggle inspector"
        >
          <Panel />
        </button>
      </header>

      <div className="workspace">
        <div
          className="canvas"
          ref={canvasRef}
          onDoubleClick={(e) => {
            if ((e.target as HTMLElement).classList.contains('react-flow__pane')) {
              const at = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
              setQuick({ mode: 'free', parent: null, at: { x: at.x - 60, y: at.y - 20 } });
            }
          }}
        >
          <ReactFlow
            nodes={rfNodes}
            edges={rfEdges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onSelectionChange={onSelectionChange}
            onConnect={onConnect}
            isValidConnection={(c) => c.source !== c.target}
            onNodeDragStart={() => void (dragging.current = true)}
            onNodeDragStop={(_, __, nodes) => {
              dragging.current = false;
              const moved = nodes.map((n) => ({ id: n.id, x: Math.round(n.position.x), y: Math.round(n.position.y) }));
              setGraph(
                (g) =>
                  g && { ...g, nodes: g.nodes.map((n) => ({ ...n, ...(moved.find((m) => m.id === n.id) ?? {}) })) },
              );
              void run(() => api.setPositions(mapId, moved), { refresh: false });
            }}
            onNodeDoubleClick={(_, n) => {
              selectIds([n.id]);
              setInspectorOpen(true);
              setFocusSignal((s) => s + 1);
            }}
            deleteKeyCode={null}
            multiSelectionKeyCode={['Shift', 'Meta', 'Control']}
            zoomOnDoubleClick={false}
            panOnScroll
            minZoom={0.1}
            maxZoom={2}
            connectionRadius={40}
            fitView
            fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={22} size={1.3} />
            <Controls showInteractive={false} position="bottom-left" style={{ marginBottom: 56 }} />
            <MiniMap
              pannable
              zoomable
              position="bottom-right"
              style={{ width: 140, height: 90 }}
              nodeColor="var(--border-strong)"
            />
          </ReactFlow>

          {graph.nodes.length === 0 && !quick && (
            <div
              style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none' }}
            >
              <div className="hintbox" style={{ textAlign: 'center' }}>
                <h3>An empty map</h3>
                Double-click anywhere, or press <kbd>N</kbd>, to add your first idea.
              </div>
            </div>
          )}

          {quick && (
            <QuickAdd
              key={`${quick.mode}-${quick.parent?.id ?? 'free'}`}
              state={quick}
              onSubmit={addNode}
              onClose={() => setQuick(null)}
            />
          )}

          {!quick && selCount > 0 && (
            <div className="floating-bar" role="toolbar" aria-label="Selection">
              <span className="count">{selCount} selected</span>
              <button className="btn sm" onClick={() => selectBranch()} title="Add all descendants (B)">
                Select branch
              </button>
              <button className="btn sm" onClick={selectPath} title="Add the path back to the root">
                Select path
              </button>
              <span className="div" />
              <span className="split">
                <button
                  className="btn primary sm"
                  onClick={() => void copyContext('markdown')}
                  style={{ borderTopRightRadius: 0, borderBottomRightRadius: 0 }}
                >
                  Copy as AI Context
                </button>
                <button
                  className="btn primary sm"
                  aria-label="More export options"
                  aria-expanded={copyMenu}
                  style={{
                    borderLeft: '1px solid var(--bg)',
                    borderTopLeftRadius: 0,
                    borderBottomRightRadius: 7,
                    borderTopRightRadius: 7,
                    borderBottomLeftRadius: 0,
                    padding: '0 6px',
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => setCopyMenu((v) => !v)}
                >
                  ▾
                </button>
                {copyMenu && (
                  <div className="menu" onMouseDown={(e) => e.stopPropagation()} onClick={() => setCopyMenu(false)}>
                    <button onClick={() => void copyContext('json')}>Copy as JSON</button>
                    <button onClick={() => void showPreview('markdown')}>Preview Markdown…</button>
                    <button onClick={() => void showPreview('json')}>Preview JSON…</button>
                    <button onClick={() => void downloadContext('markdown')}>Download .md</button>
                    <button onClick={() => void downloadContext('json')}>Download .json</button>
                  </div>
                )}
              </span>
              <button
                className="icon-btn"
                onClick={() => selectIds([])}
                aria-label="Clear selection"
                title="Clear (Esc)"
              >
                ×
              </button>
            </div>
          )}

          {preview && (
            <div className="preview" role="dialog" aria-label="AI context preview">
              <header>
                <b>AI context · {preview.format === 'json' ? 'JSON' : 'Markdown'}</b>
                <span className="spacer" />
                <button
                  className="btn sm primary"
                  onClick={async () => toast((await copyText(preview.text)) ? 'Copied' : 'Copy blocked', {})}
                >
                  Copy
                </button>
                <button className="icon-btn" onClick={() => setPreview(null)} aria-label="Close preview">
                  ×
                </button>
              </header>
              <pre>{preview.text}</pre>
            </div>
          )}

          {help && (
            <div className="popover" role="dialog" aria-label="Keyboard shortcuts">
              <h4>Shortcuts</h4>
              <dl>
                <dt>
                  <kbd>Tab</kbd>
                </dt>
                <dd>Add child · keep typing for siblings</dd>
                <dt>
                  <kbd>Enter</kbd>
                </dt>
                <dd>Add sibling</dd>
                <dt>
                  <kbd>R</kbd>
                </dt>
                <dd>Add related idea</dd>
                <dt>
                  <kbd>N</kbd>
                </dt>
                <dd>New idea anywhere (or double-click)</dd>
                <dt>
                  <kbd>B</kbd>
                </dt>
                <dd>Select branch (node + descendants)</dd>
                <dt>
                  <kbd>⇧</kbd> click / drag
                </dt>
                <dd>Multi-select / box select</dd>
                <dt>
                  <kbd>⇧⌘C</kbd>
                </dt>
                <dd>Copy as AI context</dd>
                <dt>
                  <kbd>C</kbd>
                </dt>
                <dd>Collapse / expand</dd>
                <dt>
                  <kbd>←↑↓→</kbd>
                </dt>
                <dd>Move between nodes</dd>
                <dt>
                  <kbd>⌫</kbd>
                </dt>
                <dd>Delete (undo available)</dd>
                <dt>
                  <kbd>/</kbd>
                </dt>
                <dd>Search</dd>
                <dt>
                  <kbd>F</kbd>
                </dt>
                <dd>Fit to screen</dd>
              </dl>
            </div>
          )}
        </div>

        <aside className={`inspector ${inspectorOpen ? '' : 'collapsed'}`} aria-label="Inspector">
          <Inspector graph={graph} nodeIds={sel.nodes} edgeId={sel.edge} focusSignal={focusSignal} actions={actions} />
        </aside>
      </div>
    </div>
  );
}
