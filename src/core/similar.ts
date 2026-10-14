import type { MindNode, SimilarNode } from './types.js';

const STOP = new Set(['the', 'a', 'an', 'of', 'for', 'and', 'in', 'on', 'to', 'with', 'vs', 'is', 'ai']);

/** Lowercase word tokens, stopwords removed, crude plural stemming. */
export function tokens(title: string): string[] {
  const raw = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((t) => {
      if (t.length > 4 && t.endsWith('ies')) return t.slice(0, -3) + 'y';
      return t.length > 3 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t;
    });
  const kept = raw.filter((t) => !STOP.has(t));
  return kept.length ? kept : raw;
}

function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

export const DUPLICATE_THRESHOLD = 0.85;
export const NEARBY_THRESHOLD = 0.4;

export function titleSimilarity(a: string, b: string): { score: number; reason: string } {
  const ta = tokens(a);
  const tb = tokens(b);
  const sa = new Set(ta);
  const sb = new Set(tb);
  const inter = [...sa].filter((t) => sb.has(t)).length;
  const union = new Set([...sa, ...sb]).size || 1;
  const jaccard = inter / union;

  const ja = ta.slice().sort().join(' ');
  const jb = tb.slice().sort().join(' ');
  if (ja === jb) return { score: 1, reason: 'same words' };

  const lev = 1 - levenshtein(ja, jb) / Math.max(ja.length, jb.length, 1);
  if (lev >= DUPLICATE_THRESHOLD) return { score: lev, reason: 'near-identical spelling' };
  if (jaccard >= DUPLICATE_THRESHOLD) return { score: jaccard, reason: 'nearly the same words' };
  if (inter > 0) return { score: jaccard, reason: 'shares terms (may be a parent, child or related idea)' };
  return { score: 0, reason: '' };
}

/** Existing nodes whose titles look like `title`, best first. */
export function findSimilar(nodes: MindNode[], title: string, excludeId?: string): SimilarNode[] {
  const out: SimilarNode[] = [];
  for (const node of nodes) {
    if (node.id === excludeId) continue;
    const { score, reason } = titleSimilarity(node.title, title);
    if (score >= NEARBY_THRESHOLD) out.push({ node, score: Math.round(score * 100) / 100, reason });
  }
  return out.sort((a, b) => b.score - a.score);
}

export const isDuplicate = (s: SimilarNode): boolean => s.score >= DUPLICATE_THRESHOLD;
