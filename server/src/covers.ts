import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Db } from './db';

export const coverPath = (dataPath: string, md5: string) => path.join(dataPath, 'capas', `${md5}.jpg`);

type Pending = { md5: string; title: string; authors: string };

// Looks up covers on Open Library for books not tried yet. A book with no cover
// found is marked 'none' and not retried; network errors keep it 'pending'.
export async function fetchMissingCovers(db: Db, dataPath: string, fetchFn: typeof fetch = fetch): Promise<void> {
  const pending = db.prepare("SELECT md5, title, authors FROM book WHERE cover_status = 'pending'").all() as Pending[];
  const mark = db.prepare('UPDATE book SET cover_status = ? WHERE md5 = ?');
  await mkdir(path.join(dataPath, 'capas'), { recursive: true });

  for (const book of pending) {
    let status = 'none';
    try {
      const params = new URLSearchParams({ title: book.title, limit: '1', fields: 'cover_i' });
      if (book.authors) params.set('author', book.authors.split('\n')[0]);
      const search = await fetchFn(`https://openlibrary.org/search.json?${params}`);
      const coverId = search.ok ? ((await search.json()) as { docs?: { cover_i?: number }[] }).docs?.[0]?.cover_i : undefined;
      if (coverId) {
        const image = await fetchFn(`https://covers.openlibrary.org/b/id/${coverId}-L.jpg`);
        if (image.ok) {
          await writeFile(coverPath(dataPath, book.md5), Buffer.from(await image.arrayBuffer()));
          status = 'ok';
        }
      }
    } catch (err) {
      console.warn(`Cover lookup failed for ${book.md5}:`, err);
      continue;
    }
    mark.run(status, book.md5);
  }
}
