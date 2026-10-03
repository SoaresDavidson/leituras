import type { BookSummary } from '@leituras/shared';
import { Link } from 'react-router';
import Cover from './Cover';
import StatusBadge from './StatusBadge';
import ProgressBar from './ProgressBar';

export default function BookList({ books }: { books: BookSummary[] }) {
  if (books.length === 0) return <p className="text-sm text-stone-500">Nenhum livro.</p>;
  return (
    <ul className="divide-y divide-stone-200 dark:divide-stone-800">
      {books.map((b) => (
        <li key={b.md5}>
          <Link to={`/livros/${b.md5}`} className="flex items-center gap-3 py-3 hover:opacity-80">
            <Cover book={b} className="h-16 w-11" />
            <div className="min-w-0 flex-1 space-y-1">
              <div className="truncate font-medium">{b.title}</div>
              <div className="truncate text-sm text-stone-500 dark:text-stone-400">{b.authors}</div>
              <ProgressBar value={b.progress} />
            </div>
            <StatusBadge status={b.status} />
          </Link>
        </li>
      ))}
    </ul>
  );
}
