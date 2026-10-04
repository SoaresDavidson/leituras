import { describe, expect, it } from 'vitest';
import { fuzzyFilter, fuzzyScore, normalize } from '../../web/src/fuzzy';

const books = [
  { title: 'Memórias Póstumas de Brás Cubas', authors: 'Machado de Assis' },
  { title: 'Dom Casmurro', authors: 'Machado de Assis' },
  { title: 'Grande Sertão: Veredas', authors: 'João Guimarães Rosa' },
  { title: 'Introdução a Algoritmos', authors: 'Cormen' },
];
const fields = (b: (typeof books)[number]) => [b.title, b.authors];
const titles = (q: string) => fuzzyFilter(books, q, fields).map((b) => b.title);

describe('fuzzy search', () => {
  it('ignores accents and case', () => {
    expect(normalize('Sertão ÂÉ')).toBe('sertao ae');
    expect(titles('SERTAO')).toEqual(['Grande Sertão: Veredas']);
    expect(titles('memorias')).toEqual(['Memórias Póstumas de Brás Cubas']);
  });

  it('matches subsequences and requires every word', () => {
    expect(titles('dcsmr')).toEqual(['Dom Casmurro']);
    expect(titles('machado casm')).toEqual(['Dom Casmurro']);
    expect(titles('xyz')).toEqual([]);
  });

  it('returns everything in the original order for an empty query', () => {
    expect(titles('  ')).toEqual(books.map((b) => b.title));
  });

  it('ranks contiguous and title matches above scattered ones', () => {
    expect(fuzzyScore('alg', ['Introdução a Algoritmos'])!).toBeGreaterThan(fuzzyScore('alg', ['a long gap'])!);
    // "rosa" is in the authors of one book and scattered in a title of another
    expect(titles('ros')[0]).toBe('Grande Sertão: Veredas');
    expect(fuzzyScore('dom', ['Dom Casmurro', 'x'])!).toBeGreaterThan(fuzzyScore('dom', ['x', 'Dom Casmurro'])!);
  });
});
