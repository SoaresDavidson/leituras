export default function ProgressBar({ value, className = 'bg-accent' }: { value: number; className?: string }) {
  return (
    <div className="track" title={`${Math.round(value)}%`}>
      <i className={`track-fill ${className}`} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}
