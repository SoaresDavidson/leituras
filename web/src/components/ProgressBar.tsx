export default function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded bg-stone-200 dark:bg-stone-700" title={`${Math.round(value)}%`}>
      <div className="h-full bg-emerald-500" style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}
