import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { MapGraph, MindEdge, MindNode, NodeStatus } from '../../core/types';
import type { NodePatch } from '../api';
import { timeAgo } from '../util';

export interface InspectorActions {
  patchNode: (id: string, patch: NodePatch) => Promise<void>;
  addSource: (nodeId: string, url: string, title: string) => Promise<void>;
  deleteSource: (id: string) => Promise<void>;
  connect: (from: string, to: string) => Promise<void>;
  deleteEdge: (id: string) => Promise<void>;
  updateEdge: (id: string, label: string) => Promise<void>;
  deleteNodes: (ids: string[]) => Promise<void>;
  addChild: (n: MindNode) => void;
  selectBranch: (id: string) => void;
  focusNode: (id: string) => void;
  copyContext: () => void;
  previewContext: () => void;
}

interface Props {
  graph: MapGraph;
  nodeIds: string[];
  edgeId: string | null;
  focusSignal: number;
  actions: InspectorActions;
}

export function Inspector({ graph, nodeIds, edgeId, focusSignal, actions }: Props) {
  if (nodeIds.length === 1) {
    const node = graph.nodes.find((n) => n.id === nodeIds[0]);
    if (node) return <NodeEditor key={node.id} node={node} graph={graph} focusSignal={focusSignal} actions={actions} />;
  }
  if (nodeIds.length > 1) return <MultiPanel graph={graph} ids={nodeIds} actions={actions} />;
  const edge = edgeId ? graph.edges.find((e) => e.id === edgeId) : undefined;
  if (edge) return <EdgeEditor key={edge.id} edge={edge} graph={graph} actions={actions} />;
  return <Welcome graph={graph} />;
}

function Welcome({ graph }: { graph: MapGraph }) {
  return (
    <div className="hintbox">
      <h3>{graph.map.title}</h3>
      {graph.nodes.length === 0 ? (
        <p>
          <b>Start here:</b> double-click the canvas, or press <kbd>N</kbd>, and name your first idea.
        </p>
      ) : (
        <p>
          {graph.nodes.length} nodes · {graph.edges.length} connections. Select a node to read and edit it.
        </p>
      )}
      <ul>
        <li>
          <kbd>Tab</kbd> adds a child, <kbd>R</kbd> a related idea
        </li>
        <li>Drag from a node's edge handle to connect</li>
        <li>
          <kbd>B</kbd> selects a branch; then copy it as AI context
        </li>
        <li>
          <kbd>/</kbd> searches everything
        </li>
      </ul>
    </div>
  );
}

type Draft = { title: string; summary: string; notes: string };
const FIELDS: (keyof Draft)[] = ['title', 'summary', 'notes'];

function NodeEditor({
  node,
  graph,
  focusSignal,
  actions,
}: {
  node: MindNode;
  graph: MapGraph;
  focusSignal: number;
  actions: InspectorActions;
}) {
  const [draft, setDraft] = useState<Draft>({ title: node.title, summary: node.summary, notes: node.notes });
  const [state, setState] = useState<'saved' | 'saving' | 'error'>('saved');
  const [preview, setPreview] = useState(false);
  const base = useRef<Draft>({ title: node.title, summary: node.summary, notes: node.notes });
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const titleRef = useRef<HTMLInputElement>(null);

  // Pull in remote edits (e.g. from an AI via MCP) for fields the user hasn't touched.
  useEffect(() => {
    const remote: Draft = { title: node.title, summary: node.summary, notes: node.notes };
    setDraft((d) => {
      const next = { ...d };
      for (const k of FIELDS) if (d[k] === base.current[k]) next[k] = remote[k];
      return next;
    });
    for (const k of FIELDS) if (draftRef.current[k] === base.current[k]) base.current[k] = remote[k];
  }, [node.title, node.summary, node.notes]);

  const save = useCallback(async () => {
    const d = draftRef.current;
    const patch: Partial<Draft> = {};
    for (const k of FIELDS) if (d[k] !== base.current[k]) patch[k] = d[k];
    if (patch.title !== undefined && !patch.title.trim()) delete patch.title;
    if (!Object.keys(patch).length) return;
    const prev = { ...base.current };
    Object.assign(base.current, patch);
    setState('saving');
    try {
      await actions.patchNode(node.id, patch);
      setState('saved');
    } catch {
      Object.assign(base.current, prev); // so the next edit (or blur) retries
      setState('error');
    }
  }, [actions, node.id]);

  useEffect(() => {
    const t = setTimeout(save, 600);
    return () => clearTimeout(t);
  }, [draft, save]);
  useEffect(() => {
    const flush = () => void save();
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', flush);
      flush(); // switching nodes must never drop typing
    };
  }, [save]);
  useEffect(() => {
    if (focusSignal) titleRef.current?.focus();
    if (focusSignal) titleRef.current?.select();
  }, [focusSignal]);

  const sources = graph.sources.filter((s) => s.node_id === node.id);
  const parents = graph.edges.filter((e) => e.target_node_id === node.id);
  const children = graph.edges.filter((e) => e.source_node_id === node.id);
  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph.nodes]);
  const set = (k: keyof Draft) => (e: { target: { value: string } }) =>
    setDraft((d) => ({ ...d, [k]: e.target.value }));

  return (
    <>
      <div className="insp-head">
        <span className="label" style={{ margin: 0 }}>
          Node
        </span>
        <span className={`state ${state === 'error' ? 'err' : ''}`} aria-live="polite">
          {state === 'saving' ? 'Saving…' : state === 'error' ? "Couldn't save. Will retry" : 'Saved'}
        </span>
      </div>

      <input
        ref={titleRef}
        className="field title-input"
        aria-label="Title"
        value={draft.title}
        onChange={set('title')}
        onBlur={() => {
          if (!draft.title.trim()) setDraft((d) => ({ ...d, title: base.current.title }));
          void save();
        }}
      />

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button className="btn sm" onClick={() => actions.addChild(node)}>
          + Child <kbd>Tab</kbd>
        </button>
        <button className="btn sm" onClick={() => actions.selectBranch(node.id)}>
          Select branch <kbd>B</kbd>
        </button>
        <button className="btn sm" onClick={actions.copyContext}>
          Copy as AI context
        </button>
      </div>

      <section>
        <p className="label">Status</p>
        <div className="seg" role="group" aria-label="Status">
          {(['seed', 'exploring', 'understood'] as NodeStatus[]).map((s) => (
            <button key={s} aria-pressed={node.status === s} onClick={() => actions.patchNode(node.id, { status: s })}>
              {s}
            </button>
          ))}
        </div>
      </section>

      <section>
        <p className="label">Summary</p>
        <textarea
          className="field"
          rows={3}
          placeholder="One or two sentences"
          aria-label="Summary"
          value={draft.summary}
          onChange={set('summary')}
          onBlur={() => void save()}
        />
      </section>

      <section>
        <p className="label">
          <span className="grow">Notes</span>
          <button className="link-btn" onClick={() => setPreview((p) => !p)}>
            {preview ? 'Edit' : 'Preview'}
          </button>
        </p>
        {preview ? (
          <div className="md md-box">
            <Markdown remarkPlugins={[remarkGfm]}>{draft.notes || '*Nothing yet.*'}</Markdown>
          </div>
        ) : (
          <textarea
            className="field"
            rows={9}
            placeholder="Markdown notes"
            aria-label="Notes"
            value={draft.notes}
            onChange={set('notes')}
            onBlur={() => void save()}
            style={{ fontFamily: 'var(--mono)', fontSize: 12.5 }}
          />
        )}
      </section>

      <section>
        <p className="label">Tags</p>
        <div className="chips">
          {node.tags.map((t) => (
            <span className="chip" key={t}>
              #{t}
              <button
                aria-label={`Remove tag ${t}`}
                onClick={() => actions.patchNode(node.id, { tags: node.tags.filter((x) => x !== t) })}
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <AddLine
          placeholder="Add tag, press Enter"
          onAdd={(v) =>
            actions.patchNode(node.id, {
              tags: [
                ...node.tags,
                ...v
                  .split(',')
                  .map((s) => s.trim().replace(/^#/, ''))
                  .filter(Boolean),
              ],
            })
          }
        />
      </section>

      <section>
        <p className="label">Open questions</p>
        <div className="list">
          {node.questions.map((q, i) => (
            <div className="row-item" key={q + i}>
              <div className="body">{q}</div>
              <button
                className="x"
                aria-label="Remove question"
                onClick={() => actions.patchNode(node.id, { questions: node.questions.filter((_, j) => j !== i) })}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <AddLine
          placeholder="What's unresolved?"
          onAdd={(v) => actions.patchNode(node.id, { questions: [...node.questions, v] })}
        />
      </section>

      <section>
        <p className="label">Sources</p>
        <div className="list">
          {sources.map((s) => (
            <div className="row-item" key={s.id}>
              <div className="body">
                <a href={s.url} target="_blank" rel="noreferrer noopener">
                  {s.title || hostOf(s.url)}
                </a>
                {s.title && <div className="sub">{hostOf(s.url)}</div>}
                {s.notes && <div className="sub">{s.notes}</div>}
              </div>
              <button className="x" aria-label="Remove source" onClick={() => actions.deleteSource(s.id)}>
                ×
              </button>
            </div>
          ))}
        </div>
        <AddSource onAdd={(url, title) => actions.addSource(node.id, url, title)} />
      </section>

      <section>
        <p className="label">Connections</p>
        <div className="list">
          {[
            ...parents.map((e) => ({ e, other: byId.get(e.source_node_id), dir: '←' })),
            ...children.map((e) => ({ e, other: byId.get(e.target_node_id), dir: '→' })),
          ].map(({ e, other, dir }) => (
            <div className="row-item" key={e.id}>
              <div className="body">
                <span style={{ color: 'var(--text-3)' }}>{dir} </span>
                <button className="link-btn" onClick={() => other && actions.focusNode(other.id)}>
                  {other?.title}
                </button>
                {e.label && <span className="sub"> · {e.label}</span>}
              </div>
              <button className="x" aria-label="Remove connection" onClick={() => actions.deleteEdge(e.id)}>
                ×
              </button>
            </div>
          ))}
        </div>
        <LinkPicker graph={graph} node={node} onPick={(id) => actions.connect(node.id, id)} />
      </section>

      <p className="meta-line">
        {node.provenance === 'ai'
          ? 'Added by AI'
          : node.provenance === 'source'
            ? 'Derived from a source'
            : 'Written by you'}{' '}
        · created {timeAgo(node.created_at)} · edited {timeAgo(node.updated_at)}
      </p>
      <div>
        <button className="btn danger sm" onClick={() => actions.deleteNodes([node.id])}>
          Delete node
        </button>
      </div>
    </>
  );
}

function hostOf(url: string): string {
  try {
    return (
      new URL(url).host.replace(/^www\./, '') +
      (new URL(url).pathname.length > 1 ? new URL(url).pathname.slice(0, 30) : '')
    );
  } catch {
    return url;
  }
}

function AddLine({ placeholder, onAdd }: { placeholder: string; onAdd: (v: string) => void }) {
  const [v, setV] = useState('');
  return (
    <input
      className="field"
      placeholder={placeholder}
      aria-label={placeholder}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && v.trim()) {
          onAdd(v.trim());
          setV('');
        }
      }}
    />
  );
}

function AddSource({ onAdd }: { onAdd: (url: string, title: string) => Promise<void> }) {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const submit = async () => {
    if (!url.trim()) return;
    const u = /^[a-z]+:/i.test(url.trim()) ? url.trim() : `https://${url.trim()}`;
    await onAdd(u, title.trim());
    setUrl('');
    setTitle('');
  };
  return (
    <div style={{ display: 'grid', gap: 5 }} onKeyDown={(e) => e.key === 'Enter' && submit()}>
      <input
        className="field"
        placeholder="Paste a URL, press Enter"
        aria-label="Source URL"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
      />
      {url && (
        <input
          className="field"
          placeholder="Title (optional)"
          aria-label="Source title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      )}
    </div>
  );
}

function LinkPicker({ graph, node, onPick }: { graph: MapGraph; node: MindNode; onPick: (id: string) => void }) {
  const [q, setQ] = useState('');
  const linked = new Set(
    graph.edges.flatMap((e) =>
      e.source_node_id === node.id ? [e.target_node_id] : e.target_node_id === node.id ? [e.source_node_id] : [],
    ),
  );
  const options = q.trim()
    ? graph.nodes
        .filter((n) => n.id !== node.id && !linked.has(n.id) && n.title.toLowerCase().includes(q.toLowerCase()))
        .slice(0, 8)
    : [];
  return (
    <div className="suggest">
      <input
        className="field"
        placeholder="Link to existing node…"
        aria-label="Link to existing node"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && options[0]) {
            onPick(options[0].id);
            setQ('');
          }
        }}
      />
      {options.length > 0 && (
        <div className="menu">
          {options.map((o) => (
            <button
              key={o.id}
              onClick={() => {
                onPick(o.id);
                setQ('');
              }}
            >
              {o.title}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function EdgeEditor({ edge, graph, actions }: { edge: MindEdge; graph: MapGraph; actions: InspectorActions }) {
  const [label, setLabel] = useState(edge.label);
  const name = (id: string) => graph.nodes.find((n) => n.id === id)?.title ?? '?';
  const commit = () => label !== edge.label && actions.updateEdge(edge.id, label);
  return (
    <>
      <p className="label" style={{ margin: 0 }}>
        Connection
      </p>
      <div style={{ fontWeight: 560 }}>
        {name(edge.source_node_id)} → {name(edge.target_node_id)}
      </div>
      <section>
        <p className="label">Relationship</p>
        <input
          className="field"
          autoFocus
          placeholder="e.g. is a kind of, enables, contradicts"
          aria-label="Relationship label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      </section>
      <p className="meta-line">
        {edge.provenance === 'ai' ? 'Added by AI' : 'Added by you'} · {timeAgo(edge.created_at)}
      </p>
      <div>
        <button className="btn danger sm" onClick={() => actions.deleteEdge(edge.id)}>
          Delete connection
        </button>
      </div>
    </>
  );
}

function MultiPanel({ graph, ids, actions }: { graph: MapGraph; ids: string[]; actions: InspectorActions }) {
  const nodes = graph.nodes.filter((n) => ids.includes(n.id));
  return (
    <>
      <p className="label" style={{ margin: 0 }}>
        {nodes.length} nodes selected
      </p>
      <div className="list">
        {nodes.map((n) => (
          <div className="row-item" key={n.id}>
            <div className="body">
              <button className="link-btn" onClick={() => actions.focusNode(n.id)}>
                {n.title}
              </button>
              {n.summary && <div className="sub">{n.summary}</div>}
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button className="btn primary sm" onClick={actions.copyContext}>
          Copy as AI context
        </button>
        <button className="btn sm" onClick={actions.previewContext}>
          Preview
        </button>
        <button className="btn danger sm" onClick={() => actions.deleteNodes(ids)}>
          Delete {nodes.length}
        </button>
      </div>
    </>
  );
}
