import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { migrate } from './migrations.js';

export type Db = Database.Database;

export function defaultDbPath(): string {
  return path.resolve(process.env.MINDMAP_DB ?? './data/mindmap.db');
}

/** Opens (and migrates) the database. Pass ':memory:' for tests. */
export function openDb(file: string = defaultDbPath()): Db {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  // WAL lets the web server and the MCP server share one file safely.
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}
