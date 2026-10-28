import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { defineConfig, type Plugin } from 'vite';
import { feedNoJs, howHtml, indexMd, receiptHtml, staticOutline, toyExample, type Evidence } from './src/static.js';
import type { Session } from './src/model.js';

const here = import.meta.dirname;
const gz = (b: string | Uint8Array) => zlib.gzipSync(b, { level: 9 }).length;
const evidencePath = process.env.EVIDENCE_FILE ?? path.resolve(here, '../dist/evidence.json');

const LIMITS = { 'js-gz': 90_000, 'session-gz': 40_000, 'css-gz': 8_000 };

/** Vite drops /house/ stylesheet and module tags it cannot resolve. Hide them while it works, then room() puts them back. */
function hideHouse(): Plugin {
  return {
    name: 'hide-house',
    transformIndexHtml: {
      order: 'pre',
      handler: (html: string) => html.replace(/((?:href|src)=")\/house\//g, '$1https://house.invalid/'),
    },
  };
}

/** Prerenders the receipt, outline and no-JS fallbacks, and ships evidence.json and index.md beside the page. */
function room(): Plugin {
  let evidence: Evidence | null = null;
  let budgets: Evidence['budgets'] = [];
  const session = JSON.parse(fs.readFileSync(path.resolve(here, 'session.json'), 'utf8')) as Session;
  const pos = Object.values(session.layout);
  const ratio = `${Math.max(...pos.map((p) => p.x)) + 168} / ${Math.max(...pos.map((p) => p.y)) + 44}`;
  return {
    name: 'room',
    buildStart() {
      if (fs.existsSync(evidencePath)) evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
      else if (process.env.CI) throw new Error(`evidence.json not found at ${evidencePath}`);
      else this.warn(`evidence.json not found at ${evidencePath}. The receipt will say "not measured yet".`);
    },
    // Vite drops /house/ stylesheet and module tags it cannot resolve. Hide them while it works, then put them back.
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        // Sizes come from the bundle Vite is about to write, so the budgets are the real output.
        let js = 0;
        let css = 0;
        let sessionGz = 0;
        for (const f of Object.values(ctx.bundle ?? {})) {
          if (f.type === 'chunk' && !f.isDynamicEntry) js += gz(f.code);
          else if (f.type === 'asset' && f.fileName.endsWith('.css')) css += gz(f.source as string);
          else if (f.type === 'asset' && f.fileName.includes('session')) sessionGz = gz(f.source as Uint8Array);
        }
        budgets = [
          { id: 'js-gz', limit: LIMITS['js-gz'], actual: js },
          { id: 'session-gz', limit: LIMITS['session-gz'], actual: sessionGz },
          { id: 'css-gz', limit: LIMITS['css-gz'], actual: css },
        ];
        const withBudgets = evidence ? { ...evidence, budgets } : null;
        for (const b of budgets) if (b.actual > b.limit) throw new Error(`Budget ${b.id}: ${b.actual} over ${b.limit}`);
        return html
          .replace('<!--static:toy-example-->', toyExample())
          .replace('<!--static:graph-ratio-->', ratio)
          .replace('<!--static:outline-->', staticOutline(session))
          .replace('<!--static:feed-nojs-->', feedNoJs(session))
          .replace('<!--static:receipt-->', receiptHtml(withBudgets))
          .replace('<!--static:how-->', howHtml())
          .replace(/https:\/\/house\.invalid\//g, '/house/');
      },
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'index.md',
        source: indexMd(evidence ? { ...evidence, budgets } : null, session),
      });
      if (evidence)
        this.emitFile({
          type: 'asset',
          fileName: 'evidence.json',
          source: JSON.stringify({ ...evidence, budgets }, null, 2) + '\n',
        });
    },
  };
}

// /house/ is the hub's immutable folder. It is never bundled: it is served from HOUSE_DIR in dev and by the real origin in production.
async function house(): Promise<Plugin> {
  const dir = process.env.HOUSE_DIR;
  if (dir) {
    const mod = await import(path.resolve(dir, 'house/2.0.0/tools/vite-plugin.mjs'));
    return mod.default({ houseDir: dir });
  }
  return {
    name: 'house-external',
    enforce: 'pre',
    resolveId: (id) => (id.startsWith('/house/') ? { id, external: true } : null),
  };
}

export default defineConfig(async () => ({
  base: '/mindmap-mcp/',
  plugins: [await house(), hideHouse(), room()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    assetsInlineLimit: 0,
    target: 'es2022',
    cssCodeSplit: false,
    rollupOptions: { external: [/^\/house\//] },
  },
  server: { port: 5174, fs: { allow: ['..'] } },
}));
