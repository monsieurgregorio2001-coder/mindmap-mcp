import { z } from 'zod';
import { NODE_STATUSES, PROVENANCES } from './types.js';

const trimmed = (max: number) => z.string().trim().max(max);
const url = z
  .string()
  .trim()
  .max(2000)
  .refine((v) => /^(https?:\/\/|mailto:)/i.test(v), 'URL must start with http://, https:// or mailto:');

export const tagsSchema = z.array(trimmed(60).min(1)).max(50);
export const questionsSchema = z.array(trimmed(500).min(1)).max(100);

export const mapCreate = z.object({
  title: trimmed(200).min(1),
  description: trimmed(2000).optional(),
});
export const mapUpdate = z.object({
  title: trimmed(200).min(1).optional(),
  description: trimmed(2000).optional(),
  archived: z.boolean().optional(),
});

export const nodeCreate = z.object({
  title: trimmed(300).min(1),
  summary: trimmed(2000).optional(),
  notes: z.string().max(200_000).optional(),
  tags: tagsSchema.optional(),
  questions: questionsSchema.optional(),
  status: z.enum(NODE_STATUSES).optional(),
  x: z.number().finite().optional(),
  y: z.number().finite().optional(),
  /** Connect the new node to this existing node. */
  parent_id: z.string().optional(),
  /** Label for the edge to `parent_id`. */
  relationship: trimmed(200).optional(),
  /** Direction of that edge: parent → new (default) or new → parent. */
  direction: z.enum(['from_parent', 'to_parent']).optional(),
  provenance: z.enum(PROVENANCES).optional(),
});

export const nodeUpdate = z.object({
  title: trimmed(300).min(1).optional(),
  summary: trimmed(2000).optional(),
  notes: z.string().max(200_000).optional(),
  tags: tagsSchema.optional(),
  questions: questionsSchema.optional(),
  status: z.enum(NODE_STATUSES).optional(),
  x: z.number().finite().optional(),
  y: z.number().finite().optional(),
  collapsed: z.boolean().optional(),
});

export const positionsUpdate = z.object({
  positions: z.array(z.object({ id: z.string(), x: z.number().finite(), y: z.number().finite() })).max(5000),
});

export const edgeCreate = z.object({
  source_node_id: z.string(),
  target_node_id: z.string(),
  label: trimmed(200).optional(),
  provenance: z.enum(PROVENANCES).optional(),
});
export const edgeUpdate = z.object({ label: trimmed(200) });

export const sourceCreate = z.object({
  url,
  title: trimmed(300).optional(),
  notes: trimmed(5000).optional(),
  provenance: z.enum(PROVENANCES).optional(),
});
export const sourceUpdate = z.object({
  url: url.optional(),
  title: trimmed(300).optional(),
  notes: trimmed(5000).optional(),
});

export type MapCreate = z.infer<typeof mapCreate>;
export type MapUpdate = z.infer<typeof mapUpdate>;
export type NodeCreate = z.infer<typeof nodeCreate>;
export type NodeUpdate = z.infer<typeof nodeUpdate>;
export type EdgeCreate = z.infer<typeof edgeCreate>;
export type SourceCreate = z.infer<typeof sourceCreate>;
export type SourceUpdate = z.infer<typeof sourceUpdate>;
