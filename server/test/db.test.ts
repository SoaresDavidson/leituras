import Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS, openDb } from '../src/db';

// A database file as it was before the `tipo` column existed (4 migrations applied)
function oldSchemaFile(): string {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'leituras-db-')), 'old.db');
  const old = new Database(file);
  for (const sql of MIGRATIONS.slice(0, 4)) old.exec(sql);
  old.pragma('user_version = 4');
  old.prepare("INSERT INTO book (md5, title, categoria, status_manual, area) VALUES ('A', 'Duna', 'ficção científica', 'lido', 'grafos')").run();
  old.prepare("INSERT INTO aprendizado (md5, texto, criado_em, proxima_revisao) VALUES ('A', 'nota', '2026-10-01', '2026-10-02')").run();
  old.close();
  return file;
}

describe('migração do tipo do livro', () => {
  it('adds a nullable tipo to existing books without touching their data', () => {
    const db = openDb(oldSchemaFile());
    expect(db.prepare('SELECT md5, title, categoria, status_manual, area, tipo FROM book').all()).toEqual([
      { md5: 'A', title: 'Duna', categoria: 'ficção científica', status_manual: 'lido', area: 'grafos', tipo: null },
    ]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM aprendizado').get()).toEqual({ n: 1 });
    expect(db.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length);
    db.close();
  });

  it('is idempotent: reopening a migrated database keeps it as is', () => {
    const file = oldSchemaFile();
    const first = openDb(file);
    first.prepare("UPDATE book SET tipo = 'ficcao'").run();
    first.close();
    const again = openDb(file);
    expect(again.prepare('SELECT tipo FROM book').get()).toEqual({ tipo: 'ficcao' });
    expect(again.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length);
    again.close();
  });

  it('only accepts estudo, ficcao or NULL', () => {
    const db = openDb(':memory:');
    db.prepare("INSERT INTO book (md5, title) VALUES ('A', 'x')").run();
    for (const tipo of ['estudo', 'ficcao', null]) db.prepare('UPDATE book SET tipo = ?').run(tipo);
    expect(() => db.prepare("UPDATE book SET tipo = 'romance'").run()).toThrow(/CHECK/);
  });
});
