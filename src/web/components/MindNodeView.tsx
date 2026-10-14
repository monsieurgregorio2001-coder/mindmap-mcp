import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { memo } from 'react';
import type { MindNode } from '../../core/types';

export interface MindNodeData extends Record<string, unknown> {
  node: MindNode;
  isRoot: boolean;
  childCount: number;
  hiddenCount: number;
  sourceCount: number;
  onToggle: (id: string) => void;
}
export type MindFlowNode = Node<MindNodeData, 'mind'>;

export const MindNodeView = memo(function MindNodeView({ data, selected }: NodeProps<MindFlowNode>) {
  const { node, isRoot, childCount, hiddenCount, sourceCount, onToggle } = data;
  const foot = [
    node.tags
      .slice(0, 2)
      .map((t) => `#${t}`)
      .join(' '),
    node.questions.length ? `${node.questions.length} open ?` : '',
    sourceCount ? `${sourceCount} src` : '',
  ].filter(Boolean);
  return (
    <div className={`mn ${isRoot ? 'root' : ''} ${selected ? 'selected' : ''}`} data-id={node.id} title={node.status}>
      <Handle type="target" position={Position.Left} />
      <div className="title">
        <span className={`dot ${node.status}`} aria-label={`status: ${node.status}`} />
        <span>{node.title}</span>
      </div>
      {node.summary && <div className="sum">{node.summary}</div>}
      {(foot.length > 0 || node.provenance === 'ai') && (
        <div className="foot">
          {node.provenance === 'ai' && (
            <span className="ai" title="Added by an AI agent">
              AI
            </span>
          )}
          {foot.map((f) => (
            <span key={f}>{f}</span>
          ))}
        </div>
      )}
      {childCount > 0 && (
        <button
          className={`fold nodrag nopan ${node.collapsed ? 'collapsed' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggle(node.id);
          }}
          aria-label={node.collapsed ? `Expand ${hiddenCount} hidden` : 'Collapse branch'}
          title={node.collapsed ? 'Expand branch (C)' : 'Collapse branch (C)'}
        >
          {node.collapsed ? `+${hiddenCount}` : '–'}
        </button>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  );
});
