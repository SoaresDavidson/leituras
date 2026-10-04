import Database from 'better-sqlite3';

export type Db = Database.Database;

// Each entry runs once, in order; PRAGMA user_version tracks how many ran.
const MIGRATIONS = [
  `
  CREATE TABLE device (
    id TEXT PRIMARY KEY,
    model TEXT NOT NULL
  );
  CREATE TABLE book (
    md5 TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    authors TEXT NOT NULL DEFAULT '',
    series TEXT NOT NULL DEFAULT '',
    language TEXT NOT NULL DEFAULT '',
    pages INTEGER NOT NULL DEFAULT 0,
    last_open INTEGER NOT NULL DEFAULT 0,
    -- owned by the user, never touched by imports
    categoria TEXT NOT NULL DEFAULT '',
    status_manual TEXT CHECK (status_manual IN ('lendo', 'lido', 'pausado')),
    topicos TEXT NOT NULL DEFAULT '',
    -- 'pending' | 'ok' | 'none'
    cover_status TEXT NOT NULL DEFAULT 'pending'
  );
  CREATE TABLE page_stat (
    book_md5 TEXT NOT NULL REFERENCES book(md5) ON DELETE CASCADE,
    device_id TEXT NOT NULL,
    page INTEGER NOT NULL,
    start_time INTEGER NOT NULL,
    duration INTEGER NOT NULL,
    total_pages INTEGER NOT NULL,
    PRIMARY KEY (book_md5, device_id, page, start_time)
  );
  CREATE TABLE setting (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE session (
    token_hash TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL
  );
  `,
  `
  ALTER TABLE book ADD COLUMN arquivado_em TEXT; -- YYYY-MM-DD, NULL = never archived
  CREATE TABLE fila (
    md5 TEXT PRIMARY KEY REFERENCES book(md5) ON DELETE CASCADE,
    posicao INTEGER NOT NULL
  );
  `,
];

export function openDb(filename: string): Db {
  const db = new Database(filename);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const current = db.pragma('user_version', { simple: true }) as number;
  for (let i = current; i < MIGRATIONS.length; i++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[i]);
      db.pragma(`user_version = ${i + 1}`);
    })();
  }
  return db;
}
