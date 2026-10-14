import type Database from 'better-sqlite3';

/**
 * Append-only list of migrations. Never edit a shipped migration; add a new one.
 * Plain SQL on purpose: moving to Postgres later means porting these statements
 * (TEXT/INTEGER columns, JSON stored as text, ISO timestamps as text).
 */
const MIGRATIONS: string[] = [
  /* 1: initial schema */ `
  CREATE TABLE maps (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    archived    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );

  CREATE TABLE nodes (
    id          TEXT PRIMARY KEY,
    map_id      TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    summary     TEXT NOT NULL DEFAULT '',
    notes       TEXT NOT NULL DEFAULT '',
    tags        TEXT NOT NULL DEFAULT '[]',
    questions   TEXT NOT NULL DEFAULT '[]',
    status      TEXT NOT NULL DEFAULT 'seed',
    provenance  TEXT NOT NULL DEFAULT 'user',
    x           REAL NOT NULL DEFAULT 0,
    y           REAL NOT NULL DEFAULT 0,
    collapsed   INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );
  CREATE INDEX idx_nodes_map ON nodes(map_id);

  CREATE TABLE edges (
    id             TEXT PRIMARY KEY,
    map_id         TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
    source_node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    target_node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    label          TEXT NOT NULL DEFAULT '',
    provenance     TEXT NOT NULL DEFAULT 'user',
    created_at     TEXT NOT NULL,
    UNIQUE (source_node_id, target_node_id)
  );
  CREATE INDEX idx_edges_map ON edges(map_id);
  CREATE INDEX idx_edges_target ON edges(target_node_id);

  CREATE TABLE sources (
    id         TEXT PRIMARY KEY,
    node_id    TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    title      TEXT NOT NULL DEFAULT '',
    url        TEXT NOT NULL,
    notes      TEXT NOT NULL DEFAULT '',
    provenance TEXT NOT NULL DEFAULT 'user',
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_sources_node ON sources(node_id);
  `,
];

export function migrate(db: Database.Database): number {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`);
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number | null };
  const current = row.v ?? 0;
  for (let i = current; i < MIGRATIONS.length; i++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[i]);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
        i + 1,
        new Date().toISOString(),
      );
    })();
  }
  return MIGRATIONS.length;
}
