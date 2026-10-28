// The guard eval: labelled title pairs scored with the real findSimilar. Pure, no Node APIs, shared by the CLI eval and the demo.
import { findSimilar } from './similar.js';
import type { MindNode } from './types.js';

export type PairKind = 'plural' | 'spelling' | 'reorder' | 'synonym' | 'near-miss' | 'opposite' | 'unrelated';
export interface GuardPair {
  a: string;
  b: string;
  duplicate: boolean;
  kind: PairKind;
}

export function stubNode(title: string): MindNode {
  return {
    id: 'stub',
    map_id: 'stub',
    title,
    summary: '',
    notes: '',
    tags: [],
    questions: [],
    status: 'seed',
    provenance: 'user',
    x: 0,
    y: 0,
    collapsed: false,
    created_at: '',
    updated_at: '',
  };
}

/** The score the guard gives a pair: what findSimilar returns for b against a map holding only a (0 when below the nearby floor). */
export function pairScore(a: string, b: string): number {
  return findSimilar([stubNode(a)], b)[0]?.score ?? 0;
}

/** Exact-match baseline: same title once case and spacing are ignored. */
export const exactMatch = (a: string, b: string): boolean =>
  a.trim().replace(/\s+/g, ' ').toLowerCase() === b.trim().replace(/\s+/g, ' ').toLowerCase();

export interface Confusion {
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  precision: number | null;
  recall: number | null;
  correct: number;
  total: number;
}

function confuse<T extends GuardPair>(pairs: T[], predict: (p: T) => boolean): Confusion {
  let tp = 0,
    fp = 0,
    fn = 0,
    tn = 0;
  for (const p of pairs) {
    const yes = predict(p);
    if (yes && p.duplicate) tp++;
    else if (yes) fp++;
    else if (p.duplicate) fn++;
    else tn++;
  }
  return {
    tp,
    fp,
    fn,
    tn,
    precision: tp + fp ? tp / (tp + fp) : null,
    recall: tp + fn ? tp / (tp + fn) : null,
    correct: tp + tn,
    total: pairs.length,
  };
}

export interface ScoredPair extends GuardPair {
  score: number;
}
export const scorePairs = (pairs: GuardPair[]): ScoredPair[] =>
  pairs.map((p) => ({ ...p, score: pairScore(p.a, p.b) }));

export const evalAt = (scored: ScoredPair[], threshold: number): Confusion =>
  confuse(scored, (p) => p.score >= threshold);
export const evalBaseline = (pairs: GuardPair[]): Confusion => confuse(pairs, (p) => exactMatch(p.a, p.b));

/** Thresholds 0.50 to 0.99 in steps of 0.01, as integers over 100 to avoid float drift. */
export const THRESHOLDS = Array.from({ length: 50 }, (_, i) => (50 + i) / 100);

/** Pairs whose verdict differs between two thresholds. */
export const flipped = (scored: ScoredPair[], from: number, to: number): ScoredPair[] =>
  scored.filter((p) => p.score >= from !== p.score >= to);
