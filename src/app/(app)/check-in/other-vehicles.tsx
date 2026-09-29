'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { CarFront, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { VehiclePlate } from '@/components/shared/vehicle-plate';
import type { VehicleSummary } from '@/lib/vehicles/summary';
import { formatKm } from '@/lib/format';
import { customerVehiclesAction } from '@/app/(app)/vehicles/search-action';

interface Chosen {
  mileage: string;
  /** Blank: the same work as the first vehicle. */
  complaint: string;
}

/**
 * The customer's other vehicles, to check in on the same visit — a fleet
 * dropping off several cars. Each one ticked gets its own job card, with its
 * own mileage and, if it differs, its own work. Sent as one JSON field.
 */
export function OtherVehicles({
  customerId,
  customerName,
  firstVehicleId,
  error,
}: {
  customerId: string;
  customerName: string;
  firstVehicleId: string;
  error?: string;
}) {
  const [vehicles, setVehicles] = useState<VehicleSummary[] | null>(null);
  const [chosen, setChosen] = useState<Record<string, Chosen>>({});
  const [isPending, startTransition] = useTransition();

  const others = (vehicles ?? []).filter((vehicle) => vehicle.vehicleId !== firstVehicleId);
  const payload = JSON.stringify(
    others
      .filter((vehicle) => chosen[vehicle.vehicleId])
      .map((vehicle) => ({ vehicleId: vehicle.vehicleId, ...chosen[vehicle.vehicleId] })),
  );
  const count = Object.keys(chosen).length;

  function toggle(vehicleId: string, on: boolean) {
    setChosen((current) => {
      const next = { ...current };
      if (on) next[vehicleId] = { mileage: '', complaint: '' };
      else delete next[vehicleId];
      return next;
    });
  }

  function update(vehicleId: string, patch: Partial<Chosen>) {
    setChosen((current) => ({ ...current, [vehicleId]: { ...current[vehicleId], ...patch } }));
  }

  if (vehicles === null) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => setVehicles(await customerVehiclesAction(customerId)))
          }
        >
          <Plus />
          {isPending ? 'Loading…' : `Add more of ${customerName}'s vehicles`}
        </Button>
        <span className="text-xs text-muted-foreground">Each vehicle gets its own job card.</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <input type="hidden" name="alsoVehicles" value={payload} />
      {others.length === 0 ? (
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <CarFront className="size-4" />
          {customerName} has no other vehicles on record.
          <Link
            href={`/customers/${customerId}/vehicles/new`}
            className="font-medium text-primary hover:underline"
          >
            Add a vehicle
          </Link>
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {others.map((vehicle) => {
            const selected = chosen[vehicle.vehicleId];
            const busy = vehicle.openJob;
            return (
              <li
                key={vehicle.vehicleId}
                className="flex flex-col gap-3 rounded-xl border border-border p-3 sm:p-4"
              >
                <label className="flex cursor-pointer items-center gap-3">
                  <input
                    type="checkbox"
                    className="size-4"
                    disabled={Boolean(busy)}
                    checked={Boolean(selected)}
                    onChange={(event) => toggle(vehicle.vehicleId, event.target.checked)}
                  />
                  <VehiclePlate plateNumber={vehicle.plateNumber} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {vehicle.make} {vehicle.model} {vehicle.year ?? ''}
                    </span>
                    {busy ? (
                      <span className="block text-xs text-warning">
                        Already in the workshop on {busy.jobNumber}
                      </span>
                    ) : null}
                  </span>
                </label>
                {selected ? (
                  <div className="grid gap-3 sm:grid-cols-[10rem_1fr] sm:pl-7">
                    <Input
                      aria-label={`${vehicle.plateNumber} mileage`}
                      inputMode="numeric"
                      placeholder={
                        vehicle.lastMileage !== null
                          ? `Mileage (last ${formatKm(vehicle.lastMileage)})`
                          : 'Mileage (optional)'
                      }
                      value={selected.mileage}
                      onChange={(event) =>
                        update(vehicle.vehicleId, { mileage: event.target.value })
                      }
                    />
                    <Input
                      aria-label={`${vehicle.plateNumber} work requested`}
                      placeholder="Same work as above — or type what this one needs"
                      value={selected.complaint}
                      onChange={(event) =>
                        update(vehicle.vehicleId, { complaint: event.target.value })
                      }
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {count > 0 ? (
        <p className="text-xs text-muted-foreground">
          {`${count + 1} job cards will be opened — one for each vehicle.`}
        </p>
      ) : null}
    </div>
  );
}
