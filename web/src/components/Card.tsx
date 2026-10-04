import type { ReactNode } from 'react';

export function Card({ title, actions, children }: { title?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      {(title || actions) && (
        <header className="mb-3 flex items-start justify-between gap-2.5">
          {title && <h2 className="card-title">{title}</h2>}
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="card">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}
