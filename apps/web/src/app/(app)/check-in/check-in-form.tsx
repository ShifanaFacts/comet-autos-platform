'use client';

import Link from 'next/link';
import { useActionState, useEffect, useState } from 'react';
import { CheckCircle2, Loader2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { checkIn, searchCustomers, type CheckInState, type CustomerSearchResult } from './actions';

const initialState: CheckInState = {};

interface SelectedVehicle {
  customerId: string;
  customerName: string;
  vehicleId: string;
  plateNumber: string;
  makeModel: string;
}

export function CheckInForm() {
  const [state, formAction, isPending] = useActionState(checkIn, initialState);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CustomerSearchResult[]>([]);
  const [selected, setSelected] = useState<SelectedVehicle | null>(null);
  const [creatingNew, setCreatingNew] = useState(false);

  const trimmedQuery = query.trim();

  useEffect(() => {
    if (selected || creatingNew || trimmedQuery.length < 2) return;
    const timeout = setTimeout(() => {
      searchCustomers(trimmedQuery).then(setResults).catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(timeout);
  }, [trimmedQuery, selected, creatingNew]);

  if (state.success) {
    return (
      <div className="animate-in fade-in zoom-in-95 flex flex-col items-center gap-3 rounded-lg border border-success/25 bg-success/5 px-6 py-10 text-center duration-300">
        <CheckCircle2 className="size-8 text-success" />
        <div>
          <p className="text-xs font-semibold tracking-wide text-success uppercase">Job card created</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight">{state.success.jobNumber}</p>
        </div>
        <div className="mt-2 flex gap-2">
          <Button render={<Link href={`/job-cards/${state.success.jobCardId}`} />}>Open Job Card</Button>
          <Button variant="outline" render={<Link href="/check-in" />}>
            Check in another vehicle
          </Button>
        </div>
      </div>
    );
  }

  if (selected) {
    return (
      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="mode" value="existing" />
        <input type="hidden" name="customerId" value={selected.customerId} />
        <input type="hidden" name="vehicleId" value={selected.vehicleId} />

        <div className="rounded-lg border border-border px-4 py-3">
          <p className="text-sm font-medium">{selected.customerName}</p>
          <p className="text-sm text-muted-foreground">
            {selected.plateNumber} — {selected.makeModel}
          </p>
          <button
            type="button"
            onClick={() => setSelected(null)}
            className="mt-2 text-xs text-primary underline-offset-4 hover:underline"
          >
            Change vehicle
          </button>
        </div>

        <CommonFields />

        {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
        <Button type="submit" disabled={isPending}>
          {isPending ? (
            <>
              <Loader2 className="animate-spin" />
              Checking in…
            </>
          ) : (
            'Check In'
          )}
        </Button>
      </form>
    );
  }

  if (creatingNew) {
    return (
      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="mode" value="new" />

        <div className="grid grid-cols-2 gap-3">
          <Field label="Customer name" name="customerName" required />
          <Field label="Mobile number" name="customerPhone" required />
        </div>
        <Field label="Email (optional)" name="customerEmail" type="email" />

        <div className="grid grid-cols-3 gap-3">
          <Field label="Plate number" name="plateNumber" required />
          <Field label="Make" name="make" required />
          <Field label="Model" name="model" required />
        </div>
        <Field label="Year (optional)" name="year" type="number" />

        <button
          type="button"
          onClick={() => setCreatingNew(false)}
          className="self-start text-xs text-primary underline-offset-4 hover:underline"
        >
          Search instead
        </button>

        <CommonFields />

        {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
        <Button type="submit" disabled={isPending}>
          {isPending ? (
            <>
              <Loader2 className="animate-spin" />
              Checking in…
            </>
          ) : (
            'Check In'
          )}
        </Button>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="search">Vehicle number, mobile number, or customer name</Label>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="e.g. A12345 or 050 123 4567"
            autoFocus
            className="pl-9"
          />
        </div>
      </div>

      {results.length > 0 ? (
        <ul className="animate-in fade-in flex flex-col gap-1.5 duration-200">
          {results.map((customer) =>
            customer.vehicles.length > 0 ? (
              customer.vehicles.map((vehicle) => (
                <li key={vehicle.vehicleId}>
                  <button
                    type="button"
                    onClick={() =>
                      setSelected({
                        customerId: customer.customerId,
                        customerName: customer.name,
                        vehicleId: vehicle.vehicleId,
                        plateNumber: vehicle.plateNumber,
                        makeModel: `${vehicle.make} ${vehicle.model}`,
                      })
                    }
                    className="w-full rounded-lg border border-border px-4 py-2.5 text-left transition-colors hover:border-ring/40 hover:bg-muted"
                  >
                    <p className="text-sm font-medium">{customer.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {vehicle.plateNumber} — {vehicle.make} {vehicle.model} · {customer.phone}
                    </p>
                  </button>
                </li>
              ))
            ) : (
              <li key={customer.customerId} className="rounded-lg border border-dashed border-border px-4 py-2.5 text-sm text-muted-foreground">
                {customer.name} ({customer.phone}) has no vehicles on file yet.
              </li>
            ),
          )}
        </ul>
      ) : null}

      {trimmedQuery.length >= 2 && results.length === 0 ? (
        <p className="text-sm text-muted-foreground">No matches found.</p>
      ) : null}

      <Button type="button" variant="outline" onClick={() => setCreatingNew(true)} className="self-start">
        + New customer / vehicle
      </Button>
    </div>
  );
}

function CommonFields() {
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="complaint">Complaint</Label>
        <textarea
          id="complaint"
          name="complaint"
          required
          rows={3}
          className="rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      </div>
      <Field label="Mileage (optional)" name="mileage" type="number" />
    </>
  );
}

function Field({
  label,
  name,
  type = 'text',
  required,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} type={type} required={required} />
    </div>
  );
}
