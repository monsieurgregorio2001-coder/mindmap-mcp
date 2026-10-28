// "Ask the guard" and "Move the line". The check is the repo's findSimilar over the in-memory map, run on every keystroke.
import pairsFile from '../../evals/guard-pairs.json';
import {
  evalAt,
  evalBaseline,
  flipped,
  THRESHOLDS,
  type GuardPair,
  type ScoredPair,
} from '../../src/core/guard-eval.js';
import { DUPLICATE_THRESHOLD, MemoryStore, makeNode, scoreAll } from './guard.js';
import { LINE, ROOT_TITLE, fmt, type DNode } from './model.js';
import { esc, q } from './view.js';

export const PAIRS = pairsFile.pairs as GuardPair[];
const MAX_ADDED = 8;

export const mapTitles = (nodes: DNode[]) => new MemoryStore(nodes.map((n) => makeNode(n.id, n.title)));

/** The sentence under the input. Exact wording from the room spec. */
export function verdictText(store: MemoryStore, title: string): { line: string; follow: string; refused: boolean } {
  const t = title.trim();
  if (!t)
    return {
      line: 'Type a title. The guard says how close it is to the nodes already in the map.',
      follow: '',
      refused: false,
    };
  const v = store.check(t);
  if (!v.best)
    return { line: 'Nothing in this map is close.', follow: 'Add it and it becomes a new Hand node.', refused: false };
  return {
    line: `Close to ‘${v.best.node.title}’, ${fmt(v.best.score)}. The guard refuses at ${fmt(LINE)}.`,
    follow: v.refused ? 'Add it and the guard refuses.' : 'Below the line. Add it and it becomes a new Hand node.',
    refused: v.refused,
  };
}

export const lineSummary = (scored: ScoredPair[], t: number) => {
  const c = evalAt(scored, t);
  const base = evalBaseline(PAIRS);
  const pct = (v: number | null) => (v === null ? 'none' : fmt(v));
  const dups = PAIRS.filter((p) => p.duplicate).length;
  const flips = flipped(scored, LINE, t);
  return {
    c,
    flips,
    text:
      `At ${fmt(t)} the guard refuses ${c.tp + c.fp} of ${PAIRS.length} pairs and is right on ${c.correct}. Precision ${pct(c.precision)}, recall ${pct(c.recall)}. ` +
      `Exact match refuses ${base.tp + base.fp} and catches ${base.tp} of ${dups} duplicates. ` +
      (flips.length
        ? `${flips.length} ${flips.length === 1 ? 'pair changes' : 'pairs change'} from the shipped line of ${fmt(LINE)}.`
        : `Same verdicts as the shipped line of ${fmt(LINE)}.`),
  };
};

export const flipsHtml = (flips: ScoredPair[], t: number): string =>
  flips
    .map((p) => {
      const refusedNow = p.score >= t;
      const right = refusedNow === p.duplicate;
      return `<li><span class="chip ${refusedNow ? 'chip-agent' : 'chip-hand'}">${refusedNow ? 'Now refused' : 'Now allowed'}</span> ${q(p.a)} and ${q(p.b)}<span class="flip-meta">Score ${fmt(p.score)}. Labelled ${p.duplicate ? 'a duplicate' : 'different'}. ${right ? 'Now right.' : 'Now wrong.'}</span></li>`;
    })
    .join('');

export const pairsTable = (scored: ScoredPair[], t: number): string =>
  `<table class="pairs"><caption class="sr-only">All ${PAIRS.length} labelled pairs, with the verdict at the line you set</caption><thead><tr><th scope="col">Pair</th><th scope="col">Kind</th><th scope="col">Score</th><th scope="col">Label</th><th scope="col">Guard says</th><th scope="col">Result</th></tr></thead><tbody>` +
  scored
    .map((p) => {
      const says = p.score >= t;
      return `<tr><th scope="row">${esc(p.a)} and ${esc(p.b)}</th><td>${p.kind}</td><td class="num">${fmt(p.score)}</td><td>${p.duplicate ? 'Duplicate' : 'Different'}</td><td>${says ? 'Refuse' : 'Allow'}</td><td>${says === p.duplicate ? 'Right' : 'Wrong'}</td></tr>`;
    })
    .join('') +
  `</tbody></table>`;

export const LINE_MIN = THRESHOLDS[0];
export const LINE_MAX = THRESHOLDS[THRESHOLDS.length - 1];

export interface ToyHooks {
  nodes: () => DNode[];
  added: () => DNode[];
  add: (title: string) => void;
  reset: () => void;
  changed: () => void;
}

export function initToy(root: HTMLElement, hooks: ToyHooks): void {
  const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const input = $<HTMLInputElement>('#guard-in');
  const out = $('#guard-out');
  const follow = $('#guard-follow');
  const cands = $('#guard-cands');
  const result = $('#guard-result');
  const announce = $('#guard-announce');
  const slider = $<HTMLInputElement>('#line');
  const scored = scoreAll(PAIRS);
  let timer = 0;

  const update = () => {
    const store = mapTitles([...hooks.nodes()]);
    const t = input.value;
    const v = verdictText(store, t);
    out.textContent = v.line;
    follow.textContent = v.follow;
    out.dataset.state = !t.trim() ? 'empty' : v.refused ? 'refused' : 'ok';
    const list = t.trim() ? store.check(t).candidates.slice(0, 5) : [];
    cands.innerHTML = list
      .map(
        (c) =>
          `<li><span class="num">${fmt(c.score)}</span> ${q(c.node.title)} <span class="cand-why">${esc(c.reason)}</span>${c.score >= DUPLICATE_THRESHOLD ? ' <span class="chip chip-agent">Would refuse</span>' : ''}</li>`,
      )
      .join('');
    clearTimeout(timer);
    timer = window.setTimeout(() => (announce.textContent = `${v.line} ${v.follow}`), 700);
  };
  input.addEventListener('input', () => {
    result.textContent = '';
    result.dataset.state = '';
    update();
  });

  $('#guard-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const title = input.value.trim();
    if (!title) {
      result.dataset.state = 'error';
      result.textContent = 'Type a title first.';
      return;
    }
    if (hooks.added().length >= MAX_ADDED) {
      result.dataset.state = 'error';
      result.textContent = `This page holds ${MAX_ADDED} of your nodes. Reset the map to add more.`;
      return;
    }
    const store = mapTitles(hooks.nodes());
    const v = store.check(title);
    if (v.refused) {
      result.dataset.state = 'refused';
      result.innerHTML =
        `<strong>Refused: possible_duplicate.</strong> A node like ${q(title)} already exists. The server sends back its candidates so an agent can update one instead:` +
        `<ul>${v.duplicates.map((d) => `<li>${q(d.node.title)}, ${fmt(d.score)}</li>`).join('')}</ul>`;
      return;
    }
    hooks.add(title);
    result.dataset.state = 'added';
    result.textContent = `Added ${'‘'}${title}${'’'} as a new Hand node under ${'‘'}${ROOT_TITLE}${'’'}. It exists in this page only. Nothing is saved.`;
    input.value = '';
    update();
    hooks.changed();
  });

  $('#guard-reset').addEventListener('click', () => {
    hooks.reset();
    input.value = '';
    result.dataset.state = '';
    result.textContent = hooks.added().length ? '' : 'The map is back to the recording.';
    update();
    hooks.changed();
  });

  for (const b of root.querySelectorAll<HTMLButtonElement>('[data-try]'))
    b.addEventListener('click', () => {
      input.value = b.dataset.try!;
      result.textContent = '';
      update();
      input.focus();
    });

  const flipsEl = $('#flips');
  const lineOut = $('#line-out');
  const lineSum = $('#line-sum');
  const table = $('#pairs-table');
  const setLine = () => {
    const t = Number(slider.value);
    const s = lineSummary(scored, t);
    lineOut.textContent = fmt(t);
    slider.setAttribute('aria-valuetext', `${fmt(t)}, ${s.flips.length} pairs change`);
    lineSum.textContent = s.text;
    flipsEl.innerHTML = flipsHtml(s.flips, t);
    table.innerHTML = pairsTable(scored, t);
  };
  slider.addEventListener('input', setLine);
  update();
  setLine();
}
