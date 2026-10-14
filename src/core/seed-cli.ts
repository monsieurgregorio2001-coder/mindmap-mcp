import { openDb } from './db.js';
import { seedDemo } from './seed.js';
import { Store } from './store.js';

const created = seedDemo(new Store(openDb()));
console.log(created.length ? `Seeded: ${created.join(', ')}` : 'Demo maps already exist; nothing to do.');
