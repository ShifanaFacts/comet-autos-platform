interface TimelineEntry {
  id: string;
  toStatus: string;
  fromStatus: string | null;
  changedAt: Date;
  changedBy: { fullName: string };
}

export function StatusTimeline({ entries }: { entries: TimelineEntry[] }) {
  return (
    <ol className="flex flex-col gap-4">
      {entries.map((entry, index) => (
        <li key={entry.id} className="relative flex gap-3 pl-0.5">
          <div className="flex flex-col items-center">
            <span className="mt-1 size-2 shrink-0 rounded-full bg-primary" />
            {index < entries.length - 1 ? <span className="mt-1 w-px flex-1 bg-border" /> : null}
          </div>
          <div className="pb-1">
            <p className="text-sm font-medium">
              {entry.toStatus}
              {entry.fromStatus ? <span className="font-normal text-muted-foreground"> ← {entry.fromStatus}</span> : null}
            </p>
            <p className="text-xs text-muted-foreground">
              {entry.changedAt.toLocaleString('en-AE', { dateStyle: 'medium', timeStyle: 'short' })} ·{' '}
              {entry.changedBy.fullName}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
