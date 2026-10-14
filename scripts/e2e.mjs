// End-to-end acceptance run: real server, real Chrome, real MCP client over stdio.
// Usage: npm run e2e   (needs Google Chrome; set CHROME=/path to override; SHOTS=dir to save screenshots)
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SHOTS = process.env.SHOTS;
const PORT = 4399;
const BASE = `http://127.0.0.1:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-e2e-'));
const env = { ...process.env, MINDMAP_DB: path.join(tmp, 'e2e.db'), PORT: String(PORT) };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let step = 0;
const ok = (msg) => console.log(`  ✓ ${++step}. ${msg}`);
const assert = (cond, msg) => {
  if (!cond) throw new Error('ASSERT FAILED: ' + msg);
};
const api = async (p) => (await fetch(BASE + '/api' + p)).json();
async function until(fn, what, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('Timed out waiting for ' + what);
    await sleep(150);
  }
}

const server = spawn('npx', ['tsx', 'src/server/index.ts'], { env, stdio: 'ignore' });
let browser;
let mcp;
try {
  await spawnReady();
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    userDataDir: path.join(tmp, 'chrome'),
    defaultViewport: { width: 1400, height: 860 },
  });
  const page = await browser.newPage();
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await browser.defaultBrowserContext().overridePermissions(BASE, ['clipboard-read', 'clipboard-write']);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const shot = async (n) => SHOTS && (await browser.pages()).at(-1).screenshot({ path: path.join(SHOTS, n + '.png') });
  const nodeEl = (title) =>
    page.evaluateHandle(
      (t) => [...document.querySelectorAll('.mn')].find((n) => n.querySelector('.title').textContent.trim() === t),
      title,
    );
  const clickNode = async (title) => {
    const h = (await nodeEl(title)).asElement();
    assert(h, `node "${title}" on canvas`);
    await h.click();
  };
  const nodeTitles = () => page.$$eval('.mn .title', (els) => els.map((e) => e.textContent.trim()));

  console.log('Acceptance run');
  await page.goto(BASE, { waitUntil: 'networkidle0' });

  // 1–2 launch, create topic
  assert((await page.title()) === 'Living Mindmap', 'app launches');
  ok('launched; dashboard shows empty state');
  await page.click('.empty .btn.primary');
  await page.type('input[aria-label="New map title"]', 'Understanding Agents');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.react-flow');
  ok('created topic "Understanding Agents"');

  // 3 add nodes with the keyboard
  await page.keyboard.press('n');
  await page.waitForSelector('.quick input');
  await page.type('.quick input', 'Agent');
  await page.keyboard.press('Enter');
  await until(async () => (await nodeTitles()).includes('Agent'), 'Agent node');
  await sleep(300);
  await page.keyboard.press('Tab'); // child of the selected node
  await page.waitForSelector('.quick input');
  for (const t of ['Model', 'Tool', 'Memory', 'Environment']) {
    await page.type('.quick input', t);
    await page.keyboard.press('Enter');
    await until(async () => (await nodeTitles()).includes(t), t);
  }
  await page.keyboard.press('Escape');
  const m = (await api('/maps'))[0];
  let g = await api('/maps/' + m.id);
  assert(g.nodes.length === 5 && g.edges.length === 4, `5 nodes + 4 edges (got ${g.nodes.length}/${g.edges.length})`);
  ok('added Agent, Model, Tool, Memory, Environment (child of Agent) with Tab/Enter');

  // 4 connect visually (drag handle → handle)
  await page.keyboard.press('Escape');
  const handlePos = async (title, side) => {
    const n = (await nodeEl(title)).asElement();
    await n.hover();
    const hd = await n.$(`.react-flow__handle-${side}`);
    const b = await hd.boundingBox();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  const from = await handlePos('Model', 'right');
  const to = await handlePos('Tool', 'left');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 5 });
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  await until(async () => (await api('/maps/' + m.id)).edges.length === 5, 'drag-connected edge');
  ok('connected Model → Tool by dragging');

  // 5 notes + source on Memory
  await clickNode('Memory');
  await page.waitForSelector('textarea[aria-label="Notes"]');
  await page.type('textarea[aria-label="Notes"]', 'Persistent information beyond the context window.');
  await page.type('input[aria-label="Source URL"]', 'https://example.com/memory');
  await page.keyboard.press('Enter');
  await until(async () => {
    const x = await api('/maps/' + m.id);
    return x.sources.length === 1 && x.nodes.find((n) => n.title === 'Memory').notes.includes('Persistent');
  }, 'notes + source autosaved');
  ok('notes autosaved and source added to Memory');
  await shot('1-built');

  // 6 reopen
  await page.close();
  const page2 = await browser.newPage();
  await page2.goto(`${BASE}/#/map/${m.id}`, { waitUntil: 'networkidle0' });
  await page2.waitForSelector('.mn');
  assert((await page2.$$('.mn')).length === 5, 'all 5 nodes after reopening');
  await page2.click('.mn[data-id]'); // any node
  ok('closed and reopened: everything persisted');

  // 7 search
  await page2.keyboard.press('Escape');
  await page2.keyboard.press('/');
  await page2.type('input[aria-label="Search"]', 'memory');
  await page2.waitForSelector('.result');
  await page2.keyboard.press('Enter');
  await until(
    async () =>
      (await page2.$$('.mn.selected')).length === 1 &&
      (await page2.$eval('.mn.selected .title', (e) => e.textContent.trim())) === 'Memory',
    'search focuses Memory',
  );
  ok('search for "Memory" focuses the node');

  // 8–9 branch selection + AI context
  await page2.evaluate(() => document.activeElement?.blur());
  await page2.keyboard.press('b');
  await page2.waitForSelector('.floating-bar');
  await page2.click('.floating-bar .btn.primary');
  await page2.waitForSelector('.toast');
  const clip = await page2.evaluate(() => navigator.clipboard.readText());
  assert(clip.startsWith('# Context: Memory'), 'clipboard has context: ' + clip.slice(0, 60));
  assert(
    clip.includes('Persistent information beyond the context window.') && clip.includes('https://example.com/memory'),
    'context has notes + source',
  );
  ok('selected the Memory branch; "Copy as AI Context" put Markdown on the clipboard');
  await page2.click('.floating-bar button[aria-label="More export options"]');
  await (
    await page2.evaluateHandle(() =>
      [...document.querySelectorAll('.menu button')].find((b) => b.textContent.includes('Preview JSON')),
    )
  )
    .asElement()
    .click();
  await page2.waitForSelector('.preview pre');
  const json = JSON.parse(await page2.$eval('.preview pre', (e) => e.textContent));
  assert(json.nodes[0].title === 'Memory' && json.nodes[0].sources[0].url.includes('example.com'), 'JSON preview');
  await page2.click('.preview .icon-btn');
  ok('JSON export valid');

  // 10–12 AI adds a node over MCP, UI shows it
  mcp = new Client({ name: 'e2e', version: '0' });
  await mcp.connect(
    new StdioClientTransport({ command: 'npx', args: ['tsx', 'src/mcp/index.ts'], env, stderr: 'ignore' }),
  );
  const call = async (name, args) => JSON.parse((await mcp.callTool({ name, arguments: args })).content[0].text);
  const found = await call('search_nodes', { query: 'memory', map: 'Understanding Agents' });
  const memId = found.results[0].id;
  const created = await call('create_node', {
    title: 'Episodic Memory',
    summary: 'Memory of specific past events.',
    parent_id: memId,
    relationship: 'kind of',
  });
  assert(created.created, 'MCP create_node');
  const dup = await call('create_node', { map: m.id, title: 'episodic memories' });
  assert(dup.code === 'possible_duplicate', 'MCP blocks duplicates');
  const titles2 = () => page2.$$eval('.mn .title', (e) => e.map((x) => x.textContent.trim()));
  await until(async () => (await titles2()).includes('Episodic Memory'), 'Episodic Memory in UI', 9000);
  ok('MCP client added "Episodic Memory"; it appeared in the live graph (and duplicates are refused)');
  await shot('2-after-mcp');

  // extras: collapse + undo
  await page2.evaluate(() => document.activeElement?.blur());
  const pick = async (t) =>
    (
      await page2.evaluateHandle(
        (x) => [...document.querySelectorAll('.mn')].find((n) => n.querySelector('.title').textContent.trim() === x),
        t,
      )
    ).asElement();
  await (await pick('Memory')).click();
  await page2.keyboard.press('c');
  await until(async () => !(await titles2()).includes('Episodic Memory'), 'collapse hides child');
  await page2.keyboard.press('c');
  await until(async () => (await titles2()).includes('Episodic Memory'), 'expand shows child');
  ok('collapse / expand branch');
  await (await pick('Environment')).click();
  await page2.keyboard.press('Backspace');
  await until(async () => (await api('/maps/' + m.id)).nodes.length === 5, 'deleted');
  await page2.waitForSelector('.toast button');
  await page2.click('.toast button');
  await until(async () => (await api('/maps/' + m.id)).nodes.length === 6, 'undo restored');
  ok('delete + undo');
  assert(errors.length === 0, 'no browser console errors: ' + errors.join(' | '));
  ok('no console errors');
  console.log('\nAll acceptance checks passed.');
} catch (e) {
  console.error('\nE2E FAILED:', e.message);
  process.exitCode = 1;
} finally {
  await mcp?.close().catch(() => {});
  await browser?.close().catch(() => {});
  server.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
}

async function spawnReady() {
  await until(
    async () =>
      fetch(BASE + '/api/maps')
        .then((r) => r.ok)
        .catch(() => false),
    'server start',
    20000,
  );
}
