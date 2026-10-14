import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { mapHref } from '../App';
import type { MapSummary } from '../../core/types';
import { useToast } from '../toast';
import { timeAgo } from '../util';
import { Logo, More, Plus } from './Icons';
import { SearchBox } from './SearchBox';
import { ThemeButton } from './ThemeButton';

export function Dashboard() {
  const toast = useToast();
  const [maps, setMaps] = useState<MapSummary[] | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api
      .listMaps(showArchived)
      .then(setMaps)
      .catch((e) => setError(e.message));
  }, [showArchived]);
  useEffect(load, [load]);

  const fail = (e: unknown) => toast(e instanceof Error ? e.message : 'Something went wrong', { tone: 'error' });

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="#/">
          <Logo /> Living Mindmap
        </a>
        <div className="spacer" />
        <SearchBox />
        <ThemeButton />
      </header>
      <main style={{ overflow: 'auto', flex: 1 }}>
        <div className="page">
          <div className="page-head">
            <div>
              <h1>Your maps</h1>
              <p className="sub">Rabbit holes that stay put. Open one to keep thinking.</p>
            </div>
            <div className="spacer" />
            <label className="meta-line" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show
              archived
            </label>
            <button className="btn primary" onClick={() => setCreating(true)}>
              <Plus /> New map
            </button>
          </div>

          {error && (
            <div className="empty">
              <h2>Can't load maps</h2>
              {error}
            </div>
          )}
          {maps && maps.length === 0 && !creating && (
            <div className="empty">
              <h2>No maps yet</h2>
              Start with a topic you keep coming back to.
              <div className="row">
                <button className="btn primary" onClick={() => setCreating(true)}>
                  <Plus /> New map
                </button>
                <button className="btn" onClick={() => api.seed().then(load).catch(fail)}>
                  Load demo maps
                </button>
              </div>
            </div>
          )}
          {maps && (maps.length > 0 || creating) && (
            <div className="grid">
              {creating && (
                <NewMapCard
                  onCancel={() => setCreating(false)}
                  onCreate={async (title) => {
                    try {
                      const m = await api.createMap(title);
                      window.location.hash = mapHref(m.id);
                    } catch (e) {
                      fail(e);
                    }
                  }}
                />
              )}
              {maps.map((m) => (
                <MapCard key={m.id} map={m} onChanged={load} fail={fail} />
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function NewMapCard({ onCreate, onCancel }: { onCreate: (title: string) => void; onCancel: () => void }) {
  const [title, setTitle] = useState('');
  return (
    <div className="card new">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim()) onCreate(title.trim());
        }}
      >
        <input
          className="field"
          autoFocus
          placeholder="Topic, e.g. Understanding Agents"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && onCancel()}
          aria-label="New map title"
        />
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn primary sm" type="submit" disabled={!title.trim()}>
            Create
          </button>
          <button className="btn ghost sm" type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

function MapCard({ map, onChanged, fail }: { map: MapSummary; onChanged: () => void; fail: (e: unknown) => void }) {
  const [menu, setMenu] = useState(false);
  const [mode, setMode] = useState<'view' | 'edit' | 'delete'>('view');
  const [title, setTitle] = useState(map.title);
  const [desc, setDesc] = useState(map.description);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setMenu(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [menu]);

  const run = (p: Promise<unknown>) => p.then(onChanged).catch(fail);

  if (mode === 'edit') {
    const save = () => {
      if (!title.trim()) return;
      setMode('view');
      run(api.updateMap(map.id, { title: title.trim(), description: desc.trim() }));
    };
    return (
      <div className="card new">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <input
            className="field"
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-label="Map title"
            onKeyDown={(e) => e.key === 'Escape' && setMode('view')}
          />
          <textarea
            className="field"
            rows={2}
            placeholder="Short description (optional)"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            aria-label="Map description"
          />
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn primary sm" type="submit">
              Save
            </button>
            <button className="btn ghost sm" type="button" onClick={() => setMode('view')}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className={`card ${map.archived ? 'archived' : ''}`}
      onClick={() => (window.location.hash = mapHref(map.id))}
      role="link"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget === e.target && (window.location.hash = mapHref(map.id))}
    >
      <h3>{map.title}</h3>
      {map.description && <p>{map.description}</p>}
      {mode === 'delete' ? (
        <div className="confirm" onClick={(e) => e.stopPropagation()}>
          Delete with {map.node_count} nodes?
          <button className="btn danger sm" onClick={() => run(api.deleteMap(map.id))}>
            Delete
          </button>
          <button className="btn ghost sm" onClick={() => setMode('view')}>
            Cancel
          </button>
        </div>
      ) : (
        <div className="meta">
          <span>
            {map.node_count} {map.node_count === 1 ? 'node' : 'nodes'}
          </span>
          ·<span>updated {timeAgo(map.updated_at)}</span>
          {map.archived && <span>· archived</span>}
        </div>
      )}
      <button
        className="icon-btn more"
        aria-label="Map actions"
        aria-expanded={menu}
        onClick={(e) => {
          e.stopPropagation();
          setMenu((v) => !v);
        }}
      >
        <More />
      </button>
      {menu && (
        <div className="menu" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => {
              setMenu(false);
              setMode('edit');
            }}
          >
            Rename / describe
          </button>
          <button
            onClick={() => {
              setMenu(false);
              run(api.updateMap(map.id, { archived: !map.archived }));
            }}
          >
            {map.archived ? 'Unarchive' : 'Archive'}
          </button>
          <button
            className="danger"
            onClick={() => {
              setMenu(false);
              setMode('delete');
            }}
          >
            Delete…
          </button>
        </div>
      )}
    </div>
  );
}
