import type { BookSummary } from '@leituras/shared';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import Cover from './Cover';
import StatusBadge from './StatusBadge';
import ProgressBar from './ProgressBar';

export default function BookList<T extends BookSummary>({ books, badge }: { books: T[]; badge?: (book: T) => ReactNode }) {
  if (books.length === 0) return <p className="muted">Nenhum livro.</p>;
  return (
    <ul className="list-divided">
      {books.map((b) => (
        <li key={b.md5}>
          <Link to={`/livros/${b.md5}`} className="flex items-center gap-3 py-3 hover:opacity-80">
            <Cover book={b} className="h-16 w-11" />
            <div className="min-w-0 flex-1 space-y-1">
              <div className="truncate font-medium">{b.title}</div>
              <div className="truncate muted">{b.authors}</div>
              <ProgressBar value={b.progress} scale />
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <StatusBadge status={b.status} arquivado={b.arquivado} />
              {badge?.(b)}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
