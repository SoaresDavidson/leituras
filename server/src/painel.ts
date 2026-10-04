import { PAINEL_ITENS, type PainelConfig, type PainelConfigPatch, type PainelItem } from '@leituras/shared';
import type { Db } from './db';

// Dashboard visibility is per instance (one password, one library). A missing row means the item is visible.
const key = (item: PainelItem) => `painel.${item}`;

export function getPainelConfig(db: Db): PainelConfig {
  const rows = db.prepare("SELECT key, value FROM setting WHERE key LIKE 'painel.%'").all() as { key: string; value: string }[];
  const stored = new Map(rows.map((r) => [r.key, r.value]));
  return Object.fromEntries(PAINEL_ITENS.map((item) => [item, stored.get(key(item)) !== '0'])) as PainelConfig;
}

export function updatePainelConfig(db: Db, patch: PainelConfigPatch): void {
  const upsert = db.prepare('INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  db.transaction(() => {
    for (const item of PAINEL_ITENS) {
      const value = patch[item];
      if (value !== undefined) upsert.run(key(item), value ? '1' : '0');
    }
  })();
}

export function resetPainelConfig(db: Db): void {
  db.prepare("DELETE FROM setting WHERE key LIKE 'painel.%'").run();
}

// Strict: plain object, known keys only, booleans only. Returns null when invalid.
export function parsePainelPatch(body: unknown): PainelConfigPatch | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const patch: PainelConfigPatch = {};
  for (const [name, value] of Object.entries(body)) {
    if (!(PAINEL_ITENS as readonly string[]).includes(name) || typeof value !== 'boolean') return null;
    patch[name as PainelItem] = value;
  }
  return patch;
}
