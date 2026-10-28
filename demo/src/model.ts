// The demo's data: hand nodes come from the repo's seed spec, agent moves from the recording.
import { SUPPORT_INBOX } from '../../src/core/seed-spec.js';
import { DUPLICATE_THRESHOLD, flattenSpec } from './guard.js';

export interface DNode {
  id: string; // the title: unique in the sample map
  title: string;
  summary: string;
  parent: string | null;
  by: 'hand' | 'agent' | 'you';
  step: number | null; // the recorded call that created it
  tool: string | null;
}

export interface RecordedCall {
  n: number;
  tool: string;
  note: string;
  args: Record<string, unknown>;
  is_error: boolean;
  result: Record<string, unknown>;
}

export interface Session {
  schema: 1;
  kind: 'scripted' | 'real';
  client: { name: string; version: string };
  server: { name: string; tools: number; command: string; transport: string };
  recorded_on: string;
  frames: { sent: number; received: number };
  map: { id: string; title: string };
  nodes: {
    id: string;
    title: string;
    summary: string;
    by: 'hand' | 'agent';
    parent: string | null;
    step: number | null;
  }[];
  edges: { id: string; from: string; to: string; label: string; by: 'hand' | 'agent'; step: number | null }[];
  touched: Record<string, number>;
  layout: Record<string, { x: number; y: number }>;
  ghost: { parent: string; twin: string; x: number; y: number };
  calls: RecordedCall[];
}

export const MAP_TITLE = SUPPORT_INBOX.title;
export const ROOT_TITLE = SUPPORT_INBOX.root.title;

const flat = flattenSpec(SUPPORT_INBOX.root);
export const HAND: DNode[] = flat.nodes.map((n) => ({
  id: n.id,
  title: n.title,
  summary: n.summary,
  parent: flat.parents.get(n.id) ?? null,
  by: 'hand',
  step: null,
  tool: null,
}));

export interface Model {
  nodes: DNode[]; // hand first, then agent in recorded order
  cross: { from: string; to: string; label: string; step: number }[]; // agent edges that are not tree edges
  pos: Map<string, { x: number; y: number }>;
  ghost: { title: string; parent: string; twin: string; x: number; y: number; step: number; score: number } | null;
  touched: Map<string, { step: number; tool: string }>;
  titleOf: Map<string, string>; // recorded id -> title
  steps: number;
}

export function buildModel(s: Session): Model {
  const titleOf = new Map(s.nodes.map((n) => [n.id, n.title]));
  const agent: DNode[] = s.nodes
    .filter((n) => n.by === 'agent')
    .sort((a, b) => (a.step ?? 0) - (b.step ?? 0))
    .map((n) => ({
      id: n.title,
      title: n.title,
      summary: n.summary,
      parent: n.parent ? (titleOf.get(n.parent) ?? null) : null,
      by: 'agent',
      step: n.step,
      tool: 'create_node',
    }));
  const treeEdge = new Set(agent.map((n) => `${n.parent}>${n.id}`));
  const handEdge = new Set(HAND.map((n) => `${n.parent}>${n.id}`));
  const cross = s.edges
    .filter((e) => e.by === 'agent')
    .map((e) => ({ from: titleOf.get(e.from)!, to: titleOf.get(e.to)!, label: e.label, step: e.step ?? 0 }))
    .filter((e) => !treeEdge.has(`${e.from}>${e.to}`) && !handEdge.has(`${e.from}>${e.to}`));
  const pos = new Map<string, { x: number; y: number }>();
  for (const n of s.nodes) pos.set(n.title, s.layout[n.id]);
  const refused = s.calls.find((c) => c.tool === 'create_node' && c.is_error);
  const best = refused ? (refused.result.details as { score: number }[])[0] : null;
  const touched = new Map<string, { step: number; tool: string }>();
  for (const [id, step] of Object.entries(s.touched)) touched.set(titleOf.get(id)!, { step, tool: 'update_node' });
  return {
    nodes: [...HAND, ...agent],
    cross,
    pos,
    ghost: refused
      ? {
          title: String(refused.args.title),
          parent: titleOf.get(s.ghost.parent)!,
          twin: titleOf.get(s.ghost.twin)!,
          x: s.ghost.x,
          y: s.ghost.y,
          step: refused.n,
          score: best!.score,
        }
      : null,
    touched,
    titleOf,
    steps: s.calls.length,
  };
}

export const LINE = DUPLICATE_THRESHOLD;
export const fmt = (n: number) => n.toFixed(2);
