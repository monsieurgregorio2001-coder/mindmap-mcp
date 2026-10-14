import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultDbPath, openDb } from '../core/db.js';
import { Store } from '../core/store.js';
import { createApp } from './app.js';

const port = Number(process.env.PORT ?? 4317);
const here = path.dirname(fileURLToPath(import.meta.url));
const store = new Store(openDb());
const app = createApp(store, { staticDir: path.resolve(here, '../../dist') });

app.listen(port, '127.0.0.1', () => {
  console.log(`Living Mindmap API on http://127.0.0.1:${port}  (db: ${defaultDbPath()})`);
});
