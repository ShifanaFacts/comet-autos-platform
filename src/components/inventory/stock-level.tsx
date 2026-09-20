import { StatusPill, type PillTone } from '@/components/shared/status-pill';
import type { StockState } from '@/lib/inventory/stock';
import { formatMilli } from '@/lib/money';
import { cn } from '@/lib/utils';

const STATE: Record<StockState, { label: string; tone: PillTone }> = {
  IN_STOCK: { label: 'In stock', tone: 'success' },
  LOW: { label: 'Low stock', tone: 'warning' },
  OUT: { label: 'Out of stock', tone: 'danger' },
};

export function StockPill({ state, className }: { state: StockState; className?: string }) {
  return (
    <StatusPill tone={STATE[state].tone} className={className}>
      {STATE[state].label}
    </StatusPill>
  );
}

/** Quantity on hand as the dominant figure, coloured by stock state. */
export function StockQuantity({
  onHandMilli,
  unit,
  state,
  size = 'base',
}: {
  onHandMilli: number;
  unit: string;
  state: StockState;
  size?: 'base' | 'lg';
}) {
  return (
    <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
      <span
        className={cn(
          'font-semibold tabular-nums',
          size === 'lg' ? 'text-4xl tracking-tight' : 'text-base',
          state === 'OUT' ? 'text-danger' : state === 'LOW' ? 'text-warning' : 'text-foreground',
        )}
      >
        {formatMilli(onHandMilli)}
      </span>
      <span className={cn('text-muted-foreground', size === 'lg' ? 'text-base' : 'text-xs')}>
        {unit}
      </span>
    </span>
  );
}
