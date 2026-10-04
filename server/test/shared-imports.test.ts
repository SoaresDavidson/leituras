import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// @leituras/shared ships as TypeScript source and is not installed in the production image,
// so the server may only use it for types (erased at build time).
describe('server imports of @leituras/shared', () => {
  it('are type-only', () => {
    const src = path.join(import.meta.dirname, '../src');
    const offenders = readdirSync(src)
      .filter((f) => f.endsWith('.ts'))
      .filter((f) => /^import\s+(?!type\b)[^;]*from\s+'@leituras\/shared'/m.test(readFileSync(path.join(src, f), 'utf8')));
    expect(offenders).toEqual([]);
  });
});
