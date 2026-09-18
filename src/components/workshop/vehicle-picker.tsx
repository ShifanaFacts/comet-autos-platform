'use client';

import { useEffect, useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { VehiclePlate } from '@/components/shared/vehicle-plate';
import { StatusPill } from '@/components/shared/status-pill';
import { searchVehiclesAction } from '@/app/(app)/vehicles/search-action';
import type { VehicleSummary } from '@/lib/vehicles/summary';

/** Search-first vehicle lookup used by Quick Check-In and appointment booking. */
export function VehiclePicker({
  onSelect,
  autoFocus,
  footer,
}: {
  onSelect: (vehicle: VehicleSummary) => void;
  autoFocus?: boolean;
  footer?: React.ReactNode;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<VehicleSummary[]>([]);
  const [searchedFor, setSearchedFor] = useState('');
  const [loading, setLoading] = useState(false);
  const trimmed = query.trim();

  useEffect(() => {
    if (trimmed.length < 2) return;
    const timeout = setTimeout(async () => {
      setLoading(true);
      const found = await searchVehiclesAction(trimmed);
      setResults(found);
      setSearchedFor(trimmed);
      setLoading(false);
    }, 250);
    return () => clearTimeout(timeout);
  }, [trimmed]);

  const visible = trimmed.length >= 2 ? results : [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <label htmlFor="vehicle-search" className="text-sm font-medium">
          Registration, VIN, customer name or mobile
        </label>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="vehicle-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="e.g. A 12345 or 050 123 4567"
            autoFocus={autoFocus}
            autoComplete="off"
            className="h-11 pl-9 text-base md:text-sm"
          />
          {loading ? (
            <Loader2 className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          ) : null}
        </div>
      </div>

      {visible.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border">
          {visible.map((vehicle) => (
            <li key={vehicle.vehicleId}>
              <button
                type="button"
                onClick={() => onSelect(vehicle)}
                className="flex w-full items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none"
              >
                <VehiclePlate plateNumber={vehicle.plateNumber} className="w-28 justify-center px-2 py-0.5 text-xs" />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-sm font-medium">
                    {vehicle.make} {vehicle.model} {vehicle.year ?? ''}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {vehicle.customer.name} · {vehicle.customer.phone}
                  </span>
                </span>
                {vehicle.openJob ? <StatusPill tone="warning">In workshop</StatusPill> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : trimmed.length >= 2 && !loading && searchedFor === trimmed ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          No vehicle matches “{trimmed}”.
        </p>
      ) : null}

      {footer}
    </div>
  );
}
