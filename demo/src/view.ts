// Pure string renderers. The build prerenders them (no JS needed) and the browser re-renders the same markup.
import { LINE, fmt, type DNode, type Model, type RecordedCall, type Session } from './model.js';

export const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const q = (s: string): string => `‘${esc(s)}’`;

export interface ViewState {
  step: number;
  decisions: Record<string, 'keep' | 'undo'>;
  added: DNode[];
  /** The step that just landed going forward by one, or null. Only then do nodes animate. */
  landing: number | null;
}

export const visibleNodes = (m: Model, s: ViewState): DNode[] => [
  ...m.nodes.filter((n) => n.by === 'hand' || (n.step! <= s.step && s.decisions[n.id] !== 'undo')),
  ...s.added,
];

const chip = (n: DNode): string =>
  n.by === 'agent'
    ? `<span class="chip chip-agent"><span aria-hidden="true">◆</span> Agent · ${esc(n.tool ?? 'create_node')}</span>`
    : n.by === 'you'
      ? `<span class="chip chip-you"><span aria-hidden="true">■</span> You · not saved</span>`
      : `<span class="chip chip-hand"><span aria-hidden="true">●</span> Hand</span>`;

export function outlineHtml(m: Model, s: ViewState): string {
  const nodes = visibleNodes(m, s);
  const kids = new Map<string | null, DNode[]>();
  for (const n of nodes) kids.set(n.parent, [...(kids.get(n.parent) ?? []), n]);
  const ghost = m.ghost && s.step === m.ghost.step ? m.ghost : null;
  const item = (n: DNode): string => {
    const children = (kids.get(n.id) ?? []).map(item);
    if (ghost && ghost.parent === n.id)
      children.push(
        `<li class="ol-item is-ghost"><div class="ol-row"><span class="chip chip-agent"><span aria-hidden="true">◆</span> Agent · create_node</span><span class="ol-title">${esc(ghost.title)}</span></div>` +
          `<p class="ol-sum">Refused. Close to ${q(ghost.twin)}, ${fmt(ghost.score)}. The guard refuses at ${fmt(LINE)}.</p></li>`,
      );
    const note = m.touched.get(n.id);
    const noted =
      note && note.step <= s.step ? `<p class="ol-note">Agent added notes and a tag · ${esc(note.tool)}</p>` : '';
    return (
      `<li class="ol-item is-${n.by}${s.landing !== null && n.step === s.landing ? ' is-landing' : ''}" data-node="${esc(n.id)}">` +
      `<div class="ol-row">${chip(n)}<span class="ol-title">${esc(n.title)}</span></div>` +
      (n.summary ? `<p class="ol-sum">${esc(n.summary)}</p>` : '') +
      noted +
      (children.length ? `<ul>${children.join('')}</ul>` : '') +
      `</li>`
    );
  };
  const roots = kids.get(null) ?? [];
  return `<ul class="ol">${roots.map(item).join('')}</ul>`;
}

/* The graph. Positions are precomputed in the recording, in a 168 x 44 box on a 196 x 56 grid. */
const BW = 168;
const BH = 44;
export function graphSvg(m: Model, s: ViewState): string {
  const nodes = visibleNodes(m, s);
  const present = new Set(nodes.map((n) => n.id));
  const maxX = Math.max(...[...m.pos.values()].map((p) => p.x)) + BW;
  const baseH = Math.max(...[...m.pos.values()].map((p) => p.y)) + BH;
  const addedRows = s.added.length;
  const H = baseH + (addedRows ? 24 + addedRows * 56 : 0);
  const at = (n: DNode, i: number) =>
    n.by === 'you' ? { x: 0, y: baseH + 24 + (i - nodes.filter((x) => x.by !== 'you').length) * 56 } : m.pos.get(n.id)!;
  const p = new Map(nodes.map((n, i) => [n.id, at(n, i)]));
  const edges: string[] = [];
  for (const n of nodes) {
    if (!n.parent || !present.has(n.parent)) continue;
    const a = p.get(n.parent)!;
    const b = p.get(n.id)!;
    const x1 = a.x + BW;
    const y1 = a.y + BH / 2;
    const x2 = b.x;
    const y2 = b.y + BH / 2;
    edges.push(
      `<path class="g-edge${n.by === 'agent' ? ' is-agent' : ''}${s.landing !== null && n.step === s.landing ? ' is-landing' : ''}" d="M${x1} ${y1}C${x1 + 14} ${y1} ${x2 - 14} ${y2} ${x2} ${y2}"/>`,
    );
  }
  for (const e of m.cross) {
    if (e.step > s.step || !present.has(e.from) || !present.has(e.to)) continue;
    const a = p.get(e.from)!;
    const b = p.get(e.to)!;
    const x = a.x + BW;
    const ya = a.y + BH / 2;
    const yb = b.y + BH / 2;
    edges.push(
      `<path class="g-edge is-agent is-cross${s.landing === e.step ? ' is-landing' : ''}" d="M${x} ${ya}C${x + 26} ${ya} ${x + 26} ${yb} ${x} ${yb}"/>` +
        `<text class="g-edge-label" x="${x + 22}" y="${(ya + yb) / 2}">${esc(e.label)}</text>`,
    );
  }
  const boxes = nodes.map((n) => {
    const { x, y } = p.get(n.id)!;
    const landing = s.landing !== null && n.step === s.landing;
    const noted = m.touched.get(n.id);
    return (
      `<foreignObject x="${x}" y="${y}" width="${BW}" height="${BH}" class="g-fo"><div class="g-node is-${n.by}${landing ? ' is-landing' : ''}">` +
      (n.by === 'hand'
        ? ''
        : `<span class="g-chip">${n.by === 'agent' ? `◆ Agent · ${esc(n.tool ?? '')}` : '■ You · not saved'}</span>`) +
      `<span class="g-title">${esc(n.title)}</span>` +
      (noted && noted.step <= s.step ? `<span class="g-dot" title="Agent added notes"></span>` : '') +
      `</div></foreignObject>`
    );
  });
  let ghost = '';
  const g = m.ghost && s.step === m.ghost.step ? m.ghost : null;
  if (g && p.has(g.twin)) {
    const t = p.get(g.twin)!;
    const dx = t.x + 14 - g.x;
    const dy = t.y + 8 - g.y;
    ghost =
      `<foreignObject x="${g.x}" y="${g.y}" width="${BW}" height="${BH}" class="g-fo g-ghost-fo"><div class="g-node is-ghost" style="--dx:${dx}px;--dy:${dy}px">` +
      `<span class="g-chip">◆ Agent · create_node</span><span class="g-title">${esc(g.title)}</span></div></foreignObject>` +
      `<foreignObject x="${t.x}" y="${t.y + BH + 1}" width="${BW}" height="22" class="g-fo g-score-fo"><div class="g-score">Refused · ${fmt(g.score)}</div></foreignObject>`;
  }
  return (
    `<svg viewBox="0 0 ${maxX} ${H}" width="${maxX}" height="${H}" focusable="false" aria-hidden="true">` +
    edges.join('') +
    boxes.join('') +
    ghost +
    `</svg>`
  );
}

/* Feed lines: tool, inputs, result, all read from the recorded call. */
const argLabel = (m: Model, k: string, v: unknown): string => {
  if (typeof v === 'string' && m.titleOf.has(v)) return q(m.titleOf.get(v)!);
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? q(x) : String(x))).join(', ');
  if (typeof v === 'string') return q(v.length > 48 ? v.slice(0, 47) + '…' : v);
  void k;
  return esc(String(v));
};
export const inputsOf = (m: Model, c: RecordedCall): string =>
  Object.entries(c.args)
    .filter(([k]) => k !== 'summary' && k !== 'relationship' && k !== 'questions' && k !== 'append_notes')
    .map(([k, v]) => `<span class="kv"><span class="k">${esc(k)}</span> ${argLabel(m, k, v)}</span>`)
    .join(' ');

export function resultOf(m: Model, c: RecordedCall): string {
  const r = c.result as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const t = (id: string) => m.titleOf.get(id) ?? id;
  if (c.is_error && r.code === 'possible_duplicate') {
    const d = r.details[0] as { title: string; score: number };
    return `Refused. Close to ${q(d.title)}, ${fmt(d.score)}. The guard refuses at ${fmt(LINE)}.`;
  }
  if (c.is_error) return `Error: ${esc(String(r.error))}`;
  switch (c.tool) {
    case 'list_maps':
      return `${r.maps.length} map: ${q(r.maps[0].title)}, ${r.maps[0].node_count} nodes.`;
    case 'get_map':
      return `${r.nodes.length} nodes and ${r.edges.length} edges read.`;
    case 'search_nodes':
      return `${r.results.length} found: ${r.results.map((x: { title: string }) => q(x.title)).join(', ')}.`;
    case 'get_node':
      return `${q(r.node.title)} read, with ${r.children.length} children.`;
    case 'create_node':
      return (
        `Created ${q(r.node.title)} as an agent node.` +
        (r.similar_nodes ? ` ${r.similar_nodes.length} similar nodes returned.` : '')
      );
    case 'update_node':
      return `Updated ${q(r.node.title)}. Notes and a tag added.`;
    case 'create_edge':
      return `Connected ${q(t(r.edge.source_node_id))} to ${q(t(r.edge.target_node_id))} as ${q(r.edge.label)}.`;
    default:
      return 'Done.';
  }
}

export function feedList(m: Model, s: Session, step: number): string {
  return (
    `<ol class="feed-list">` +
    s.calls
      .map((c) => {
        const state = c.n === step ? ' aria-current="step"' : '';
        return (
          `<li class="feed-item${c.n <= step ? '' : ' is-future'}${c.is_error ? ' is-refused' : ''}">` +
          `<button type="button" class="feed-line" data-step="${c.n}"${state}>` +
          `<span class="feed-n">${c.n}</span><span class="feed-body"><span class="feed-tool">${esc(c.tool)}</span> <span class="feed-in">${inputsOf(m, c)}</span>` +
          `<span class="feed-out">${resultOf(m, c)}</span></span></button>` +
          `<details class="feed-raw"><summary>Raw call ${c.n}</summary><pre>${esc(JSON.stringify({ tool: c.tool, arguments: c.args, is_error: c.is_error, result: c.result }, null, 1))}</pre></details></li>`
        );
      })
      .join('') +
    `</ol>`
  );
}

export function sessionLabel(s: Session): string {
  return s.kind === 'scripted'
    ? `The agent's moves were scripted, not chosen by a model.`
    : `Recorded from a real session: ${esc(s.client.name)} used these tools through MCP on ${esc(s.recorded_on)}. Unedited except timestamps.`;
}
