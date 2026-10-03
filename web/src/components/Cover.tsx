import type { BookSummary } from '@leituras/shared';
import { coverUrl } from '../api';

export default function Cover({ book, className = 'h-20 w-14' }: { book: BookSummary; className?: string }) {
  if (!book.hasCover)
    return <div className={`${className} shrink-0 rounded bg-stone-200 dark:bg-stone-800`} />;
  return <img src={coverUrl(book.md5)} alt="" loading="lazy" className={`${className} shrink-0 rounded object-cover`} />;
}
