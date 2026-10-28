// Scores evals/guard-pairs.json with the real findSimilar and writes the result into dist/evidence.json (evals).
//   npm run eval:guard   (needs dist/evidence.json from `npm run evidence`; it replaces only the guard-pairs entry)
import fs from 'node:fs';
import { DUPLICATE_THRESHOLD } from '../src/core/similar.js';
import { THRESHOLDS, evalAt, evalBaseline, scorePairs, type GuardPair, type PairKind } from '../src/core/guard-eval.js';

export const GUARD_EVAL_LABEL = 'Labels drafted by Claude Code. Garfield has not reviewed them yet.';
export const PAIRS_FILE = 'evals/guard-pairs.json';

const r2 = (v: number | null) => (v === null ? null : Math.round(v * 100) / 100);

export function guardEvalEntry() {
  const file = JSON.parse(fs.readFileSync(PAIRS_FILE, 'utf8')) as { pairs: GuardPair[] };
  const pairs = file.pairs;
  const scored = scorePairs(pairs);
  const at = evalAt(scored, DUPLICATE_THRESHOLD);
  const base = evalBaseline(pairs);
  const clean = THRESHOLDS.find((t) => evalAt(scored, t).fp === 0);
  const kinds = [...new Set(pairs.map((p) => p.kind))] as PairKind[];
  return {
    id: 'guard-pairs',
    label: GUARD_EVAL_LABEL,
    title: 'Duplicate guard on 60 labelled title pairs',
    passed: at.correct,
    total: at.total,
    command: 'npm run eval:guard',
    labelled_by: PAIRS_FILE,
    limits: 'The guard compares words, not meaning. Synonyms and paraphrases are not caught.',
    reviewed_by_owner: false,
    threshold: DUPLICATE_THRESHOLD,
    precision: r2(at.precision),
    recall: r2(at.recall),
    baseline: {
      name: 'exact match',
      precision: r2(base.precision),
      recall: r2(base.recall),
      tp: base.tp,
      fp: base.fp,
      fn: base.fn,
    },
    thresholds: THRESHOLDS.filter((t) => Math.round(t * 100) % 5 === 0 || t === 0.99).map((t) => {
      const c = evalAt(scored, t);
      return { threshold: t, tp: c.tp, fp: c.fp, fn: c.fn, tn: c.tn, precision: r2(c.precision), recall: r2(c.recall) };
    }),
    lowest_clean: clean === undefined ? null : { threshold: clean, recall: r2(evalAt(scored, clean).recall) },
    false_refusals: scored
      .filter((p) => !p.duplicate && p.score >= DUPLICATE_THRESHOLD)
      .map((p) => ({ a: p.a, b: p.b, score: p.score })),
    by_kind: kinds.map((kind) => {
      const ofKind = scored.filter((p) => p.kind === kind);
      const duplicate = ofKind[0].duplicate;
      return {
        kind,
        duplicate,
        total: ofKind.length,
        // For duplicate kinds this is pairs caught, for the others it is pairs wrongly refused.
        refused: ofKind.filter((p) => p.score >= DUPLICATE_THRESHOLD).length,
      };
    }),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = 'dist/evidence.json';
  if (!fs.existsSync(file)) {
    console.error(`${file} not found. Run npm run evidence first.`);
    process.exit(1);
  }
  const e = JSON.parse(fs.readFileSync(file, 'utf8'));
  const entry = guardEvalEntry();
  e.evals = [...(e.evals ?? []).filter((x: { id: string }) => x.id !== entry.id), entry];
  fs.writeFileSync(file, JSON.stringify(e, null, 2) + '\n');
  console.log(
    `guard-pairs: ${entry.passed}/${entry.total} at ${entry.threshold}, precision ${entry.precision}, recall ${entry.recall}`,
  );
}
