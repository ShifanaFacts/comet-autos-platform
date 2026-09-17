import { cn } from '@/lib/utils';

/** A compact, plate-styled chip for a vehicle registration number — used anywhere a vehicle needs to read as the headline (job cards, check-in, search results). */
export function VehiclePlate({ plateNumber, className }: { plateNumber: string; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-md border-2 border-foreground/70 bg-secondary px-2.5 py-1 font-mono text-sm font-bold tracking-[0.15em] text-foreground',
        className,
      )}
    >
      {plateNumber}
    </span>
  );
}
