// Captures docs/screenshot.png of the web UI with the sample map. Needs Chrome (set CHROME=/path to override).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 4398;
const BASE = `http://127.0.0.1:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-shot-'));
const env = { ...process.env, MINDMAP_DB: path.join(tmp, 'shot.db'), PORT: String(PORT) };
const server = spawn('npx', ['tsx', 'src/server/index.ts'], { env, stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let browser;
try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(BASE + '/api/maps')).ok) break;
    } catch {
      // server not up yet
    }
    await sleep(250);
  }
  await fetch(BASE + '/api/seed', { method: 'POST' });
  const maps = await (await fetch(BASE + '/api/maps')).json();
  const list = Array.isArray(maps) ? maps : maps.maps;
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    defaultViewport: { width: 1400, height: 860 },
  });
  const page = await browser.newPage();
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await page.evaluate((id) => (location.hash = '#/map/' + id), list[0].id);
  await sleep(1500);
  fs.mkdirSync('docs', { recursive: true });
  await page.screenshot({ path: 'docs/screenshot.png' });
  console.log('Saved docs/screenshot.png');
} finally {
  await browser?.close();
  server.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
}
