import { useEffect, useRef, useState } from 'react';
import type { MindNode } from '../../core/types';

export type QuickMode = 'child' | 'related' | 'free';
export interface QuickState {
  mode: QuickMode;
  parent: MindNode | null;
  at?: { x: number; y: number };
}

interface Props {
  state: QuickState;
  /** Creates the node; resolves to it so we can chain. */
  onSubmit: (title: string, s: QuickState) => Promise<MindNode | undefined>;
  onClose: () => void;
}

/** One-line quick add. Enter adds and stays (siblings); Tab adds and goes deeper; Esc closes. */
export function QuickAdd({ state: initial, onSubmit, onClose }: Props) {
  const [state, setState] = useState(initial);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const last = useRef<MindNode | undefined>(undefined);
  useEffect(() => input.current?.focus(), []);

  const submit = async (deeper: boolean) => {
    const title = text.trim();
    if (busy) return;
    if (!title) {
      if (deeper && last.current) setState({ mode: 'child', parent: last.current });
      return;
    }
    setBusy(true);
    const node = await onSubmit(title, state);
    setBusy(false);
    if (!node) return;
    last.current = node;
    setText('');
    if (state.mode === 'free') onClose();
    else if (deeper) setState({ mode: 'child', parent: node });
  };

  const label = state.mode === 'free' ? 'New idea' : state.mode === 'related' ? 'Related to' : 'Child of';
  return (
    <div className="floating-bar quick" role="dialog" aria-label="Quick add">
      <div className="ctx">
        {label} {state.parent && <b>{state.parent.title}</b>}
        {state.parent && (
          <span style={{ marginLeft: 'auto' }} className="seg">
            <button aria-pressed={state.mode === 'child'} onClick={() => setState({ ...state, mode: 'child' })}>
              child
            </button>
            <button aria-pressed={state.mode === 'related'} onClick={() => setState({ ...state, mode: 'related' })}>
              related
            </button>
          </span>
        )}
      </div>
      <input
        ref={input}
        className="field"
        value={text}
        placeholder={state.mode === 'related' ? 'e.g. Andy Kaufman' : 'Name the idea'}
        aria-label="New node title"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') {
            e.preventDefault();
            void submit(false);
          } else if (e.key === 'Tab' && !e.shiftKey) {
            e.preventDefault();
            void submit(true);
          } else if (e.key === 'Escape') onClose();
        }}
      />
      <div className="hint">
        <span>
          <kbd>Enter</kbd> add{state.mode !== 'free' && ' another'}
        </span>
        {state.mode !== 'free' && (
          <span>
            <kbd>Tab</kbd> add &amp; go deeper
          </span>
        )}
        <span>
          <kbd>Esc</kbd> done
        </span>
      </div>
    </div>
  );
}
