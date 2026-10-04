// Accent- and case-insensitive fuzzy matching, small enough for a few hundred books.

export const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const TITLE_BONUS = 20;

// Contiguous match scores 100 (+20 at a word start); a scattered subsequence scores 50 minus the gaps.
function tokenScore(token: string, text: string): number | null {
  const idx = text.indexOf(token);
  if (idx >= 0) return 100 + (idx === 0 || !/[a-z0-9]/.test(text[idx - 1]) ? 20 : 0);
  let pos = -1;
  let gaps = 0;
  for (const ch of token) {
    const next = text.indexOf(ch, pos + 1);
    if (next < 0) return null;
    if (pos >= 0) gaps += next - pos - 1;
    pos = next;
  }
  return Math.max(1, 50 - gaps);
}

// Every word of the query must match some field; the first field (the title) weighs more.
// Returns null when there is no match.
export function fuzzyScore(query: string, fields: string[]): number | null {
  const tokens = normalize(query).split(/\s+/).filter(Boolean);
  const texts = fields.map(normalize);
  let total = 0;
  for (const token of tokens) {
    let best: number | null = null;
    texts.forEach((text, i) => {
      const s = tokenScore(token, text);
      if (s != null) best = Math.max(best ?? 0, s + (i === 0 ? TITLE_BONUS : 0));
    });
    if (best == null) return null;
    total += best;
  }
  return total;
}

// Best match first; an empty query keeps the original order.
export function fuzzyFilter<T>(items: T[], query: string, fields: (item: T) => string[]): T[] {
  if (!query.trim()) return items;
  return items
    .map((item, i) => ({ item, i, score: fuzzyScore(query, fields(item)) }))
    .filter((r) => r.score != null)
    .sort((a, b) => b.score! - a.score! || a.i - b.i)
    .map((r) => r.item);
}
