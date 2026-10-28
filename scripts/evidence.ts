// Writes dist/evidence.json (schema 1) from real runs of the unit suite, verify:mcp and the bench.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const run = (cmd: string, args: string[]) =>
  spawnSync(cmd, args, { encoding: 'utf8', shell: process.platform === 'win32', maxBuffer: 64e6 });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-evidence-'));
const vitestOut = path.join(tmp, 'vitest.json');
run('npx', ['vitest', 'run', '--reporter=json', `--outputFile=${vitestOut}`]);
const vt = JSON.parse(fs.readFileSync(vitestOut, 'utf8')) as { numPassedTests: number; numTotalTests: number };
fs.rmSync(tmp, { recursive: true, force: true });

const verify = run('npm', ['run', '--silent', 'verify:mcp']);
const toolCount = Number(/Server exposes (\d+) tools/.exec(verify.stdout)?.[1] ?? 0);
const verifyOk = verify.status === 0;

const bench = run('npm', ['run', '--silent', 'bench']);
const m = /calls=(\d+) failures=(\d+) median=([\d.]+)ms/.exec(bench.stdout);

const figures: object[] = [];
if (toolCount > 0)
  figures.push({
    id: 'tools',
    value: toolCount,
    unit: 'tools',
    label: 'MCP tools registered by the stdio server',
    source: 'scripts/verify-mcp.ts',
  });
if (m && bench.status === 0)
  figures.push({
    id: 'bench-median-ms',
    value: Number(m[3]),
    unit: 'ms',
    label: `median round trip over ${m[1]} stdio tool calls`,
    source: 'scripts/bench.ts',
  });

const sha = run('git', ['rev-parse', '--short', 'HEAD']).stdout.trim();
const ci = process.env.GITHUB_ACTIONS === 'true';
const evidence = {
  schema: 1,
  room: 'mindmap',
  commit: sha,
  ran_at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
  runner: ci
    ? `GitHub Actions ${process.env.ImageOS ?? 'ubuntu'}, Node ${process.versions.node.split('.')[0]}`
    : `local ${os.platform()}, Node ${process.versions.node.split('.')[0]}`,
  tests: [
    { id: 'unit', label: 'Unit tests', passed: vt.numPassedTests, total: vt.numTotalTests, command: 'npm test' },
    {
      id: 'verify-mcp',
      label: 'MCP server lists all 12 tools',
      passed: verifyOk ? toolCount : 0,
      total: 12,
      command: 'npm run verify:mcp',
    },
  ],
  evals: [],
  figures,
  budgets: [],
  limits: ['Lexical matching only.', 'No model runs in the browser.', 'The agent session is recorded, not live.'],
};
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/evidence.json', JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(evidence, null, 2));
