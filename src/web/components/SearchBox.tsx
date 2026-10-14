import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { api } from '../api';
import { mapHref } from '../App';
import type { SearchHit } from '../../core/types';
import { isTyping } from '../util';
import { Search } from './Icons';

export interface SearchHandle {
  focus: () => void;
}

/** Global search. `onPick` handles same-map hits (focus in place); other maps navigate. */
export const SearchBox = forwardRef<SearchHandle, { currentMapId?: string; onPick?: (nodeId: string) => void }>(
  function SearchBox({ currentMapId, onPick }, ref) {
    const [q, setQ] = useState('');
    const [hits, setHits] = useState<SearchHit[] | null>(null);
    const [active, setActive] = useState(0);
    const [open, setOpen] = useState(false);
    const input = useRef<HTMLInputElement>(null);
    const box = useRef<HTMLDivElement>(null);
    useImperativeHandle(ref, () => ({ focus: () => input.current?.focus() }));

    useEffect(() => {
      const onKey = (e: KeyboardEvent) => {
        if ((e.key === '/' && !isTyping(e.target)) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) {
          e.preventDefault();
          input.current?.focus();
          input.current?.select();
        }
      };
      const onDown = (e: MouseEvent) => {
        if (!box.current?.contains(e.target as Node)) setOpen(false);
      };
      window.addEventListener('keydown', onKey);
      window.addEventListener('mousedown', onDown);
      return () => {
        window.removeEventListener('keydown', onKey);
        window.removeEventListener('mousedown', onDown);
      };
    }, []);

    useEffect(() => {
      if (!q.trim()) {
        setHits(null);
        return;
      }
      let stale = false;
      const t = setTimeout(() => {
        api
          .search(q.trim())
          .then((r) => {
            if (stale) return;
            // Current map first, then by score.
            r.sort(
              (a, b) =>
                Number(b.node.map_id === currentMapId) - Number(a.node.map_id === currentMapId) || b.score - a.score,
            );
            setHits(r);
            setActive(0);
          })
          .catch(() => !stale && setHits([]));
      }, 120);
      return () => {
        stale = true;
        clearTimeout(t);
      };
    }, [q, currentMapId]);

    const pick = (h: SearchHit) => {
      setOpen(false);
      setQ('');
      input.current?.blur();
      if (h.node.map_id === currentMapId && onPick) onPick(h.node.id);
      else window.location.hash = mapHref(h.node.map_id, h.node.id);
    };

    return (
      <div className="search" ref={box}>
        <span className="mag">
          <Search />
        </span>
        <input
          ref={input}
          className="field"
          placeholder="Search nodes, notes, tags"
          aria-label="Search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setOpen(false);
              input.current?.blur();
            } else if (e.key === 'ArrowDown' && hits?.length) {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, hits.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === 'Enter' && hits?.[active]) {
              pick(hits[active]);
            }
          }}
        />
        {!q && <kbd className="slash">/</kbd>}
        {open && hits && (
          <div className="results" role="listbox">
            {hits.length === 0 && <div className="none">No matches</div>}
            {hits.map((h, i) => (
              <button
                key={h.node.id}
                className={`result ${i === active ? 'active' : ''}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(h)}
                role="option"
                aria-selected={i === active}
              >
                <div className="t">
                  {h.node.title}
                  <span className="m">{h.node.map_id === currentMapId ? '' : h.map_title}</span>
                </div>
                {(h.snippet || h.matched.length > 0) && (
                  <div className="s">
                    <span className="w">{h.matched.filter((m) => m !== 'title').join(' · ')}</span>
                    {h.snippet}
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  },
);
