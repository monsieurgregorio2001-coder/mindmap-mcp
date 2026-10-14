import { useEffect, useState } from 'react';
import { Dashboard } from './components/Dashboard';
import { MapView } from './components/MapView';
import { ToastProvider } from './toast';

export interface Route {
  mapId: string | null;
  focus: string | null;
}

function parse(): Route {
  const [path, query = ''] = window.location.hash.replace(/^#/, '').split('?');
  const m = path.match(/^\/map\/([^/]+)/);
  return { mapId: m ? decodeURIComponent(m[1]) : null, focus: new URLSearchParams(query).get('node') };
}

export const mapHref = (id: string, node?: string) =>
  `#/map/${encodeURIComponent(id)}${node ? `?node=${encodeURIComponent(node)}` : ''}`;

export function App() {
  const [route, setRoute] = useState<Route>(parse);
  useEffect(() => {
    const on = () => setRoute(parse());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return (
    <ToastProvider>
      {route.mapId ? <MapView key={route.mapId} mapId={route.mapId} focus={route.focus} /> : <Dashboard />}
    </ToastProvider>
  );
}
