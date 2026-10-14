import express, { type ErrorRequestHandler, type Request, type RequestHandler } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import * as S from '../core/schemas.js';
import { seedDemo } from '../core/seed.js';
import type { Store } from '../core/store.js';
import { MindmapError, type DeletedSnapshot } from '../core/types.js';

const param = (req: Request, name: string): string => String(req.params[name]);

const STATUS: Record<MindmapError['code'], number> = {
  not_found: 404,
  invalid: 400,
  conflict: 409,
  possible_duplicate: 409,
  ambiguous: 409,
};

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

export function createApp(store: Store, opts: { staticDir?: string } = {}) {
  const app = express();
  app.disable('x-powered-by');

  // Local-only tool: refuse requests whose Host isn't loopback (DNS-rebinding guard).
  app.use((req, res, next) => {
    if (!LOCAL_HOST.test(req.headers.host ?? '')) {
      res.status(403).json({ error: 'Living Mindmap only answers on localhost' });
      return;
    }
    next();
  });
  app.use('/api', express.json({ limit: '5mb' }));

  const api = express.Router();
  const body = <T extends z.ZodType>(schema: T, req: Request): z.infer<T> => schema.parse(req.body ?? {});

  /* maps */
  api.get('/maps', (req, res) => {
    res.json(store.listMaps({ includeArchived: req.query.archived === '1' }));
  });
  api.post('/maps', (req, res) => {
    res.status(201).json(store.createMap(body(S.mapCreate, req)));
  });
  api.get('/maps/:id', (req, res) => {
    res.json(store.getGraph(param(req, 'id')));
  });
  api.patch('/maps/:id', (req, res) => {
    res.json(store.updateMap(param(req, 'id'), body(S.mapUpdate, req)));
  });
  api.delete('/maps/:id', (req, res) => {
    store.deleteMap(param(req, 'id'));
    res.status(204).end();
  });
  api.put('/maps/:id/positions', (req, res) => {
    store.setPositions(param(req, 'id'), body(S.positionsUpdate, req).positions);
    res.status(204).end();
  });
  api.post('/maps/:id/restore', (req, res) => {
    const snap = req.body as DeletedSnapshot;
    if (!snap || snap.map_id !== param(req, 'id') || !Array.isArray(snap.nodes)) {
      throw new MindmapError('invalid', 'Body must be a snapshot returned by a delete');
    }
    store.restore(snap);
    res.json(store.getGraph(snap.map_id));
  });
  api.post('/maps/:id/context', (req, res) => {
    const input = body(
      z.object({ node_ids: z.array(z.string()).min(1), format: z.enum(['markdown', 'json']).default('markdown') }),
      req,
    );
    res.json(store.getContext(param(req, 'id'), { nodeIds: input.node_ids }, input.format));
  });

  /* nodes */
  api.post('/maps/:id/nodes', (req, res) => {
    res.status(201).json(store.createNode(param(req, 'id'), body(S.nodeCreate, req), { provenance: 'user' }));
  });
  api.patch('/nodes/:id', (req, res) => {
    res.json(store.updateNode(param(req, 'id'), body(S.nodeUpdate, req)));
  });
  api.delete('/nodes/:id', (req, res) => {
    res.json(store.deleteNode(param(req, 'id')));
  });
  api.post('/nodes/:id/sources', (req, res) => {
    res.status(201).json(store.addSource(param(req, 'id'), body(S.sourceCreate, req), 'user').source);
  });

  /* edges & sources */
  api.post('/maps/:id/edges', (req, res) => {
    const { edge, created } = store.createEdge(param(req, 'id'), body(S.edgeCreate, req), 'user');
    res.status(created ? 201 : 200).json(edge);
  });
  api.patch('/edges/:id', (req, res) => {
    res.json(store.updateEdge(param(req, 'id'), body(S.edgeUpdate, req).label));
  });
  api.delete('/edges/:id', (req, res) => {
    res.json(store.deleteEdge(param(req, 'id')));
  });
  api.patch('/sources/:id', (req, res) => {
    res.json(store.updateSource(param(req, 'id'), body(S.sourceUpdate, req)));
  });
  api.delete('/sources/:id', (req, res) => {
    res.json(store.deleteSource(param(req, 'id')));
  });

  /* search & misc */
  api.get('/search', (req, res) => {
    const q = String(req.query.q ?? '');
    const mapId = req.query.map_id ? String(req.query.map_id) : undefined;
    res.json(store.search(q, { mapId }));
  });
  api.post('/seed', (_req, res) => {
    res.json({ created: seedDemo(store) });
  });

  app.use('/api', api);
  app.use('/api', ((_req, res) => {
    res.status(404).json({ error: 'Unknown API route' });
  }) as RequestHandler);

  if (opts.staticDir && fs.existsSync(opts.staticDir)) {
    app.use(express.static(opts.staticDir));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(opts.staticDir!, 'index.html')));
  }

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    void _next;
    if (err instanceof MindmapError) {
      res.status(STATUS[err.code]).json({ error: err.message, code: err.code, details: err.details });
    } else if (err instanceof z.ZodError) {
      res.status(400).json({
        error: err.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '),
        code: 'invalid',
      });
    } else if (err?.type === 'entity.parse.failed') {
      res.status(400).json({ error: 'Invalid JSON body', code: 'invalid' });
    } else {
      console.error(err);
      res.status(500).json({ error: 'Internal error' });
    }
  };
  app.use(onError);
  return app;
}
