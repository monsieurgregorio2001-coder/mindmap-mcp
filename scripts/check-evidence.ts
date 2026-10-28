// Shape check for dist/evidence.json (schema 1). Exits 1 on any violation.
import fs from 'node:fs';

const file = process.argv[2] ?? 'dist/evidence.json';
const e = JSON.parse(fs.readFileSync(file, 'utf8'));
const errs: string[] = [];
const isStr = (v: unknown) => typeof v === 'string' && v.length > 0;
const isNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
const arr = (k: string) =>
  Array.isArray(e[k]) ? (e[k] as Record<string, unknown>[]) : (errs.push(`${k} must be an array`), []);

if (e.schema !== 1) errs.push('schema must be 1');
if (e.room !== 'mindmap') errs.push('room must be "mindmap"');
if (!/^[0-9a-f]{7,40}$/.test(e.commit ?? '')) errs.push('commit must be a hex sha');
if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(e.ran_at ?? '')) errs.push('ran_at must be ISO UTC');
if (!isStr(e.runner)) errs.push('runner required');
for (const t of arr('tests')) {
  for (const k of ['id', 'label', 'command']) if (!isStr(t[k])) errs.push(`tests.${t.id}.${k} required`);
  if (!isNum(t.passed) || !isNum(t.total) || (t.passed as number) > (t.total as number))
    errs.push(`tests.${t.id} counts invalid`);
}
for (const f of arr('figures')) {
  for (const k of ['id', 'unit', 'label', 'source']) if (!isStr(f[k])) errs.push(`figures.${f.id}.${k} required`);
  if (!isNum(f.value)) errs.push(`figures.${f.id}.value must be a number`);
}
for (const v of arr('evals')) {
  for (const k of ['id', 'label', 'command', 'labelled_by']) if (!isStr(v[k])) errs.push(`evals.${v.id}.${k} required`);
  if (!isNum(v.passed) || !isNum(v.total) || (v.passed as number) > (v.total as number))
    errs.push(`evals.${v.id} counts invalid`);
}
for (const b of arr('budgets'))
  if (!isStr(b.id) || !isNum(b.limit) || !isNum(b.actual)) errs.push(`budgets.${b.id} invalid`);
if (!Array.isArray(e.limits) || !e.limits.every(isStr)) errs.push('limits must be a string array');
if (errs.length) {
  console.error('evidence.json shape errors:\n- ' + errs.join('\n- '));
  process.exit(1);
}
console.log('evidence.json shape ok');
