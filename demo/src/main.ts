import './style.css';
import { initToy } from './toy.js';
import { HAND, buildModel, type DNode, type Model, type Session } from './model.js';
import { esc, feedList, graphSvg, outlineHtml, resultOf, sessionLabel, visibleNodes, type ViewState } from './view.js';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const sessionUrl = new URL('../session.json', import.meta.url).href;

const empty: Model = {
  nodes: HAND,
  cross: [],
  pos: new Map(),
  ghost: null,
  touched: new Map(),
  titleOf: new Map(),
  steps: 0,
};
let model: Model = empty;
let session: Session | null = null;
const state: ViewState = { step: 0, decisions: {}, added: [], landing: null };
let timer = 0;
let youCount = 0;

const wide = matchMedia('(min-width: 1280px)');
const outline = $('outline');
const graph = $('graph');
const feed = $('feed');
const sheet = $<HTMLDialogElement>('sheet');

function renderMap(): void {
  outline.innerHTML = outlineHtml(model, state);
  if (session) {
    graph.innerHTML = graphSvg(model, state);
    graph.removeAttribute('data-state');
    const ghost = graph.querySelector<HTMLElement>('.g-ghost-fo .g-node');
    if (ghost) {
      if (state.landing === null) ghost.classList.add('drift', 'is-still');
      else requestAnimationFrame(() => requestAnimationFrame(() => ghost.classList.add('drift')));
    }
  }
  state.landing = null;
}

function syncFeed(): void {
  if (!session) return;
  const total = model.steps;
  const range = $<HTMLInputElement>('scrub');
  range.value = String(state.step);
  range.setAttribute(
    'aria-valuetext',
    state.step
      ? `Step ${state.step} of ${total}, ${session.calls[state.step - 1].tool}`
      : `Before the first call, of ${total}`,
  );
  $('scrub-out').textContent = `${state.step} of ${total}`;
  $<HTMLButtonElement>('step-back').disabled = state.step === 0;
  $<HTMLButtonElement>('step-next').disabled = state.step === total;
  feed.querySelectorAll<HTMLElement>('.feed-item').forEach((li, i) => {
    li.classList.toggle('is-future', i + 1 > state.step);
    const b = li.querySelector('button')!;
    if (i + 1 === state.step) b.setAttribute('aria-current', 'step');
    else b.removeAttribute('aria-current');
  });
  const c = state.step ? session.calls[state.step - 1] : null;
  $('step-status').textContent = c
    ? `Step ${state.step} of ${total}. ${c.tool}. ${stripTags(resultOf(model, c))}`
    : `Step 0 of ${total}. Nothing has happened yet. Press Next or Play.`;
  const atEnd = state.step === total;
  $('your-turn').hidden = !atEnd;
  $<HTMLButtonElement>('play').textContent = timer ? 'Pause' : 'Play';
}
const stripTags = (h: string): string => {
  const d = document.createElement('div');
  d.innerHTML = h;
  return d.textContent ?? '';
};

function go(step: number, forwardOne = false): void {
  if (!session) return;
  const next = Math.max(0, Math.min(model.steps, step));
  state.landing = forwardOne || next === state.step + 1 ? next : null;
  state.step = next;
  renderMap();
  syncFeed();
}
const stop = () => {
  clearInterval(timer);
  timer = 0;
};
function play(): void {
  stop();
  if (state.step >= model.steps) go(0);
  timer = window.setInterval(() => {
    if (state.step >= model.steps) {
      stop();
      syncFeed();
      return;
    }
    go(state.step + 1, true);
  }, 1700);
  syncFeed();
}

function buildFeed(): void {
  if (!session) return;
  const total = model.steps;
  const agent = model.nodes.filter((n) => n.by === 'agent');
  feed.innerHTML =
    `<h2 id="feed-h">Hand and agent</h2>` +
    `<p class="note">${sessionLabel(session)}</p>` +
    `<p class="note">Replayed from the recording. The tool handlers do not run in your browser.</p>` +
    `<p class="note meta">Recorded on ${esc(session.recorded_on)} by ${esc(session.client.name)} against the real ${esc(session.server.transport)} server, ${session.server.tools} tools, ${session.frames.sent + session.frames.received} messages.</p>` +
    `<div class="scrub"><button type="button" class="house-capsule is-ghost" id="step-back">Back</button>` +
    `<button type="button" class="house-capsule is-ghost" id="play">Play</button>` +
    `<button type="button" class="house-capsule is-ghost" id="step-next">Next</button>` +
    `<label class="scrub-l" for="scrub">Recorded call</label><input id="scrub" type="range" min="0" max="${total}" step="1" value="${state.step}"><output id="scrub-out" for="scrub"></output></div>` +
    `<p id="step-status" class="step-status" role="status"></p>` +
    feedList(model, session, state.step) +
    `<div id="your-turn" class="turn" hidden><h3>Your turn</h3><p>Keep or undo each agent node. This changes your copy of the map in this page. Nothing is saved or sent.</p><ul>` +
    agent
      .map(
        (n) =>
          `<li data-node="${esc(n.id)}"><span class="chip chip-agent"><span aria-hidden="true">◆</span> Agent · ${esc(n.tool ?? '')}</span> <span class="turn-t">${esc(n.title)}</span>` +
          `<span class="turn-b"><button type="button" class="house-capsule is-ghost" data-d="keep" aria-pressed="false">Keep</button><button type="button" class="house-capsule is-ghost" data-d="undo" aria-pressed="false">Undo</button></span></li>`,
      )
      .join('') +
    `</ul><p id="turn-out" class="turn-out" role="status"></p></div>`;
  syncFeed();
}

function place(): void {
  const open = !wide.matches;
  if (open) {
    if (feed.parentElement !== $('sheet-body')) $('sheet-body').append(feed);
  } else {
    if (sheet.open) sheet.close();
    if (feed.parentElement !== $('feed-slot')) $('feed-slot').append(feed);
  }
}

async function load(): Promise<void> {
  feed.dataset.state = 'loading';
  feed.innerHTML = `<h2 id="feed-h">Hand and agent</h2><p class="note" role="status">Loading the recording…</p>`;
  graph.dataset.state = 'loading';
  try {
    const r = await fetch(sessionUrl);
    if (!r.ok) throw new Error(String(r.status));
    session = (await r.json()) as Session;
    model = buildModel(session);
    state.step = model.steps;
    delete feed.dataset.state;
    buildFeed();
    renderMap();
  } catch {
    feed.dataset.state = 'error';
    graph.dataset.state = 'error';
    feed.innerHTML =
      `<h2 id="feed-h">Hand and agent</h2><p class="note" role="alert">The recording did not load. The outline above shows the finished map.</p>` +
      `<button type="button" class="house-capsule is-ghost" id="retry">Try again</button>`;
  }
}

// One set of listeners for the feed, which moves between the page and the sheet.
feed.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  if (t.closest('#retry')) void load();
  else if (t.closest('#play')) {
    if (timer) {
      stop();
      syncFeed();
    } else play();
  } else if (t.closest('#step-back')) {
    stop();
    go(state.step - 1);
  } else if (t.closest('#step-next')) {
    stop();
    go(state.step + 1, true);
  } else if (t.closest('.feed-line')) {
    stop();
    go(Number((t.closest('.feed-line') as HTMLElement).dataset.step));
  } else if (t.closest('[data-d]')) {
    const b = t.closest('[data-d]') as HTMLButtonElement;
    const li = b.closest('li')!;
    const id = li.dataset.node!;
    state.decisions[id] = b.dataset.d as 'keep' | 'undo';
    li.querySelectorAll<HTMLButtonElement>('[data-d]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    const kept = Object.values(state.decisions).filter((d) => d === 'keep').length;
    const undone = Object.values(state.decisions).filter((d) => d === 'undo').length;
    $('turn-out').textContent =
      `${b.dataset.d === 'keep' ? 'Kept' : 'Undone'}: \u2018${id}\u2019. You kept ${kept} and undid ${undone}. This is your copy in this page.`;
    renderMap();
  }
});
feed.addEventListener('input', (e) => {
  const t = e.target as HTMLInputElement;
  if (t.id === 'scrub') {
    stop();
    go(Number(t.value));
  }
});

$('replay').addEventListener('click', () => {
  if (!session) {
    void load().then(() => start());
  } else start();
});
function start(): void {
  if (!wide.matches) sheet.showModal();
  else feed.scrollIntoView({ block: 'nearest', behavior: 'auto' });
  go(0);
  play();
}
$('sheet-close').addEventListener('click', () => sheet.close());
sheet.addEventListener('close', () => {
  stop();
  if (session) syncFeed();
});
sheet.addEventListener('click', (e) => {
  if (e.target === sheet) sheet.close();
});
wide.addEventListener('change', place);

initToy($('toy'), {
  nodes: () => visibleNodes(model, state),
  added: () => state.added,
  add: (title) => {
    const n: DNode = {
      id: `you:${++youCount}`,
      title,
      summary: '',
      parent: model.nodes[0].id,
      by: 'you',
      step: null,
      tool: null,
    };
    state.added.push(n);
  },
  reset: () => {
    state.added = [];
  },
  changed: renderMap,
});

place();
const idle =
  (window as unknown as { requestIdleCallback?: (f: () => void) => void }).requestIdleCallback ??
  ((f: () => void) => setTimeout(f, 200));
idle(() => void load());
