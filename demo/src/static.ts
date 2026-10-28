// Build-time markup: everything here is rendered once from the repo's code and evidence.json, so a page with JavaScript off still tells the truth.
import { MemoryStore, makeNode } from './guard.js';
import { HAND, LINE, buildModel, fmt, type Session } from './model.js';
import { esc, inputsOf, q, resultOf, sessionLabel, outlineHtml } from './view.js';

export interface Evidence {
  schema: number;
  room: string;
  commit: string;
  ran_at: string;
  runner: string;
  tests: { id: string; label: string; passed: number; total: number; command: string }[];
  evals: GuardEval[];
  figures: { id: string; value: number; unit: string; label: string; source: string }[];
  budgets: { id: string; limit: number; actual: number }[];
  limits: string[];
}
export interface GuardEval {
  id: string;
  label: string;
  title: string;
  passed: number;
  total: number;
  command: string;
  labelled_by: string;
  limits: string;
  threshold: number;
  precision: number | null;
  recall: number | null;
  baseline: { name: string; precision: number | null; recall: number | null; tp: number; fp: number; fn: number };
  thresholds: {
    threshold: number;
    tp: number;
    fp: number;
    fn: number;
    tn: number;
    precision: number | null;
    recall: number | null;
  }[];
  by_kind: { kind: string; duplicate: boolean; total: number; refused: number }[];
  lowest_clean: { threshold: number; recall: number | null } | null;
  false_refusals: { a: string; b: string; score: number }[];
}

const NM = '<span class="house-fig is-missing">not measured yet</span>';
const kb = (n: number) => `${(n / 1000).toFixed(1)} KB`;
const num = (n: number | null) => (n === null ? 'none' : n.toFixed(2));

export function toyExample(): string {
  const store = new MemoryStore(HAND.map((n) => makeNode(n.id, n.title)));
  const title = 'Help-centre articles';
  const v = store.check(title);
  return (
    `<p class="toy-lede">The guard runs in your browser, so it needs JavaScript. This is what it does, worked out when this page was built.</p>` +
    `<p class="verdict">Close to ${q(v.best!.node.title)}, ${fmt(v.best!.score)}. The guard refuses at ${fmt(LINE)}.</p>` +
    `<p class="follow">${esc(title)} would be refused.</p><p class="fixed">The guard compares words, not meaning.</p>`
  );
}

export function feedNoJs(s: Session): string {
  const m = buildModel(s);
  return (
    `<p class="note">${sessionLabel(s)}</p><p class="note">Replayed from the recording. The tool handlers do not run in your browser.</p>` +
    `<p>The replay needs JavaScript. These are the ${s.calls.length} recorded calls.</p><ol class="feed-list">` +
    s.calls
      .map(
        (c) =>
          `<li class="feed-item"><span class="feed-line"><span class="feed-n">${c.n}</span><span class="feed-body"><span class="feed-tool">${esc(c.tool)}</span> <span class="feed-in">${inputsOf(m, c)}</span><span class="feed-out">${resultOf(m, c)}</span></span></span></li>`,
      )
      .join('') +
    `</ol>`
  );
}

export function staticOutline(s: Session): string {
  const m = buildModel(s);
  return outlineHtml(m, { step: m.steps, decisions: {}, added: [], landing: null });
}

function row(dt: string, dd: string): string {
  return `<div><dt>${dt}</dt><dd>${dd}</dd></div>`;
}

export function receiptHtml(e: Evidence | null): string {
  if (!e) {
    return `<section class="band" id="receipt" aria-labelledby="receipt-h"><h2 id="receipt-h">Receipt</h2><article class="house-receipt"><p>${NM}</p></article></section>`;
  }
  const g = e.evals.find((x) => x.id === 'guard-pairs');
  const tests = e.tests
    .map(
      (t) =>
        `<li>${esc(t.label)}: <span class="house-fig">${t.passed} of ${t.total}</span> <code>${esc(t.command)}</code></li>`,
    )
    .join('');
  const nodeMin = e.figures.find((f) => f.id === 'node-min');
  const bench = e.figures.find((f) => f.id === 'bench-median-ms');
  const tools = e.figures.find((f) => f.id === 'tools');
  const figs = [nodeMin, tools, bench]
    .filter(Boolean)
    .map((f) => {
      const p = f!;
      return `<li>${esc(p.label)}: <span class="house-fig">${p.value} ${esc(p.unit)}</span></li>`;
    })
    .join('');
  const budgets = e.budgets.length
    ? e.budgets
        .map(
          (b) =>
            `<li>${esc(budgetName[b.id] ?? b.id)}: <span class="house-fig">${kb(b.actual)}</span> of ${kb(b.limit)}</li>`,
        )
        .join('')
    : `<li>${NM}</li>`;

  let evalHtml = `<p>${NM}</p>`;
  if (g) {
    const misses = g.by_kind
      .filter((k) => k.duplicate)
      .map((k) => `${k.kind}: ${k.refused} of ${k.total} caught`)
      .join(', ');
    const falseOnes = g.false_refusals.length
      ? g.false_refusals.map((f) => `${q(f.a)} and ${q(f.b)} (${fmt(f.score)})`).join(', ')
      : 'none';
    evalHtml =
      `<p>${esc(g.label)}</p>` +
      `<p>${esc(g.title)}: <span class="house-fig">${g.passed} of ${g.total}</span> right at ${fmt(g.threshold)}. Precision <span class="house-fig">${num(g.precision)}</span>, recall <span class="house-fig">${num(g.recall)}</span>. ` +
      `${esc(g.baseline.name[0].toUpperCase() + g.baseline.name.slice(1))} baseline: precision <span class="house-fig">${num(g.baseline.precision)}</span>, recall <span class="house-fig">${num(g.baseline.recall)}</span>. <code>${esc(g.command)}</code></p>` +
      `<div class="receipt-scroll" tabindex="0" role="region" aria-label="Precision and recall table"><table class="pairs"><caption class="sr-only">Guard precision and recall at each refusal line, against the exact-match baseline</caption><thead><tr><th scope="col">Line</th><th scope="col">Refused</th><th scope="col">False refusals</th><th scope="col">Duplicates missed</th><th scope="col">Precision</th><th scope="col">Recall</th></tr></thead><tbody>` +
      g.thresholds
        .map(
          (t) =>
            `<tr${t.threshold === g.threshold ? ' class="is-shipped"' : ''}><th scope="row">${fmt(t.threshold)}${t.threshold === g.threshold ? ' (shipped)' : ''}</th><td class="num">${t.tp + t.fp}</td><td class="num">${t.fp}</td><td class="num">${t.fn}</td><td class="num">${num(t.precision)}</td><td class="num">${num(t.recall)}</td></tr>`,
        )
        .join('') +
      `<tr><th scope="row">Exact match</th><td class="num">${g.baseline.tp + g.baseline.fp}</td><td class="num">${g.baseline.fp}</td><td class="num">${g.baseline.fn}</td><td class="num">${num(g.baseline.precision)}</td><td class="num">${num(g.baseline.recall)}</td></tr>` +
      `</tbody></table></div>` +
      `<h3 class="sub">Why ${fmt(g.threshold)}</h3><p>${fmt(g.threshold)} is <code>DUPLICATE_THRESHOLD</code> in <code>src/core/similar.ts</code>. This eval measures that line. It did not set it. ` +
      (g.lowest_clean
        ? `On these pairs the lowest line with no false refusal is ${fmt(g.lowest_clean.threshold)}, where recall is ${num(g.lowest_clean.recall)}. Moving the line trades a missed duplicate for a wrong refusal, and the slider above shows each pair that flips.`
        : `No line on these pairs removes every false refusal.`) +
      `</p><h3 class="sub">What it misses</h3><p>Duplicates caught, by kind: ${esc(misses)}. Wrong refusals at ${fmt(g.threshold)}: ${falseOnes}. The guard compares words, not meaning, so a synonym is a different title to it, and a title that differs by one prefix can look the same.</p>` +
      `<p class="note">${esc(g.limits)}</p>`;
  }
  return (
    `<section class="band" id="receipt" aria-labelledby="receipt-h"><h2 id="receipt-h">Receipt</h2>` +
    `<article class="house-receipt"><dl class="house-receipt-rows">` +
    row('Tests', `<ul class="plain">${tests}</ul>`) +
    row(
      'Measured',
      `<ul class="plain">${figs}</ul><p class="note">Run ${esc(e.ran_at)} on ${esc(e.runner)}, commit ${esc(e.commit)}.</p>`,
    ) +
    row('Evals', evalHtml) +
    row('Budgets', `<ul class="plain">${budgets}</ul>`) +
    row(
      'What this does not do',
      `<ul class="plain">${e.limits.map((l) => `<li>${esc(l)}</li>`).join('')}<li>The sample map is made up and no project here was built for it.</li></ul>`,
    ) +
    `</dl></article></section>`
  );
}

const budgetName: Record<string, string> = {
  'js-gz': 'JavaScript before interaction, gzip',
  'session-gz': 'Recorded session, loaded later, gzip',
  'css-gz': 'CSS, gzip',
};

export function howHtml(): string {
  const col = (h: string, items: string[]) =>
    `<div class="how-col"><h3>${h}</h3>${items.length ? `<ul class="plain">${items.map((i) => `<li>${i}</li>`).join('')}</ul>` : `<p>Not recorded for this project yet.</p>`}</div>`;
  return (
    `<section class="band" id="how" aria-labelledby="how-h"><h2 id="how-h">How this was built</h2>` +
    `<div class="how">` +
    col('What AI did', [
      'Wrote the agent conventions and local context files (pull request 1, with Garfield as co-author).',
      'Added the evidence script, its shape check, the Node pin and the native rebuild in CI (pull request 2, commit d5bf7e8).',
      'Built this room: the demo package, the parity test, the scripted recording and the 60-pair guard eval (branch phase-3c/room).',
    ]) +
    col('What I decided', [
      'The recording is scripted. The agent’s moves are written in <code>scripts/record-session.ts</code> and run against the real server (ADR 0001).',
    ]) +
    col('What I rejected or corrected', []) +
    `</div>` +
    `<div class="proposed card"><h3>Proposed by Claude, waiting for Garfield’s review</h3><ul class="plain">` +
    [
      'Keep the shipped line of 0.85 and measure it, instead of tuning it to the sample pairs (ADR 0001).',
      'Ship the 60 pair labels as drafted by Claude Code, marked unreviewed (ADR 0001).',
      'Open the page on the finished map, with Replay the agent starting from the first call (ADR 0001).',
      'Keep the demo in its own package so the Pages build never compiles the native database module (ADR 0001).',
    ]
      .map((t) => `<li>${t}</li>`)
      .join('') +
    `</ul></div></section>`
  );
}

export function indexMd(e: Evidence | null, s: Session): string {
  const g = e?.evals.find((x) => x.id === 'guard-pairs');
  const lines = [
    '# Living Mindmap',
    '',
    'People and an agent edit one map. Every agent edit is marked, and near-duplicates are refused.',
    '',
    'Recorded demo · Sample content · No model runs here',
    '',
    `## ${s.map.title}`,
    '',
    'Sample content. Not a real project.',
    '',
    outlineText(s),
    '## Hand and agent',
    '',
    sessionLabel(s).replace(/&#39;/g, "'"),
    'Replayed from the recording. The tool handlers do not run in your browser.',
    '',
    ...s.calls.map((c) => `${c.n}. ${c.tool}: ${stripHtml(resultOf(buildModel(s), c))}`),
    '',
    '## Ask the guard',
    '',
    'The guard compares words, not meaning.',
    '',
  ];
  if (e && g) {
    lines.push('## Receipt', '', ...e.tests.map((t) => `- ${t.label}: ${t.passed} of ${t.total} (${t.command})`));
    lines.push(
      `- ${g.label}`,
      `- ${g.title}: ${g.passed} of ${g.total} right at ${fmt(g.threshold)}. Precision ${num(g.precision)}, recall ${num(g.recall)}.`,
    );
    lines.push('', ...e.limits.map((l) => `- ${l}`));
  }
  return lines.join('\n') + '\n';
}
const stripHtml = (h: string) =>
  h
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
function outlineText(s: Session): string {
  const m = buildModel(s);
  const kids = (p: string | null) => m.nodes.filter((n) => n.parent === p);
  const walk = (p: string | null, d: number): string[] =>
    kids(p).flatMap((n) => [
      `${'  '.repeat(d)}- ${n.title} (${n.by === 'agent' ? 'Agent' : 'Hand'})`,
      ...walk(n.id, d + 1),
    ]);
  return walk(null, 0).join('\n') + '\n';
}
