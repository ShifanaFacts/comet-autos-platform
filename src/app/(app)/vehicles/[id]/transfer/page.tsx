import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeftRight, TriangleAlert, UserRound } from 'lucide-react';
import { hasPermission, requireUser } from '@/lib/auth/authorize';
import { NotFoundError } from '@/lib/errors';
import { getVehicleDetail } from '@/lib/vehicles/service';
import { listCustomers } from '@/lib/customers/service';
import { OPEN_JOB_STATUSES } from '@/lib/workshop/check-in';
import { PageHeader, Panel, Stack } from '@/components/layout/primitives';
import { AccessDenied } from '@/components/shared/access-denied';
import { EmptyState } from '@/components/shared/empty-state';
import { SearchField } from '@/components/shared/search-field';
import { VehiclePlate } from '@/components/shared/vehicle-plate';
import { TransferVehicleForm } from '@/components/vehicles/transfer-vehicle-form';

/**
 * Changing who owns a vehicle. Deliberately a two-step page rather than a
 * one-tap action: find the new owner, then confirm by typing the
 * registration. Past jobs, invoices and approvals stay with the people they
 * were for — only the vehicle moves.
 */
export default async function TransferVehiclePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string; to?: string }>;
}) {
  const user = await requireUser();
  if (!hasPermission(user, 'vehicle.edit'))
    return <AccessDenied what="changing a vehicle's owner" />;

  const { id } = await params;
  const { q, to } = await searchParams;
  const query = (q ?? '').trim();

  let vehicle;
  try {
    vehicle = await getVehicleDetail(user, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const chosen = to
    ? ((await listCustomers(user, '')).find((customer) => customer.id === to) ??
      (await listCustomers(user, query)).find((customer) => customer.id === to) ??
      null)
    : null;
  const matches = chosen ? [] : await listCustomers(user, query);
  const candidates = matches.filter((customer) => customer.id !== vehicle.customerId).slice(0, 20);
  const openJobs = vehicle.jobCards.filter((job) => OPEN_JOB_STATUSES.includes(job.status));
  const base = `/vehicles/${vehicle.id}/transfer`;

  return (
    <Stack gap="2xl" className="animate-in fade-in duration-300">
      <PageHeader
        eyebrow={
          <Link
            href={`/vehicles/${vehicle.id}`}
            className="tracking-normal normal-case hover:text-foreground"
          >
            ← {vehicle.make} {vehicle.model}
          </Link>
        }
        leading={
          <VehiclePlate plateNumber={vehicle.plateNumber} className="px-3 py-1.5 text-base" />
        }
        title="Change owner"
        description={
          <>
            Owned by <span className="font-medium text-foreground">{vehicle.customer.name}</span>.
            Every job already on this vehicle stays with the person who brought it in.
          </>
        }
      />

      {openJobs.length > 0 ? (
        <div className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/5 px-4 py-4 text-sm sm:px-6">
          <TriangleAlert className="mt-0.5 size-5 shrink-0 text-warning" />
          <div className="flex flex-col gap-1">
            <p className="font-medium text-warning">
              {openJobs.length === 1 ? 'A job is open' : `${openJobs.length} jobs are open`} on this
              vehicle
            </p>
            <p className="text-muted-foreground">
              {openJobs.map((job) => job.jobNumber).join(', ')} will stay with{' '}
              {vehicle.customer.name}, who brought the vehicle in. The new owner takes over from the
              next visit.
            </p>
          </div>
        </div>
      ) : null}

      {chosen ? (
        <Panel className="max-w-2xl">
          <TransferVehicleForm
            vehicleId={vehicle.id}
            plateNumber={vehicle.plateNumber}
            previousOwnerName={vehicle.customer.name}
            newOwner={{ id: chosen.id, name: chosen.name, phone: chosen.phone }}
            changeHref={`${base}${query ? `?q=${encodeURIComponent(query)}` : ''}`}
          />
        </Panel>
      ) : (
        <Stack gap="base">
          <SearchField initialQuery={query} placeholder="New owner's name, phone or email" />
          {candidates.length === 0 ? (
            <EmptyState
              icon={UserRound}
              title={query ? `No customer matches “${query}”` : 'Search for the new owner'}
              description={
                query
                  ? 'Check the spelling, or search by phone number.'
                  : 'Type a name or phone number to find the person taking the vehicle.'
              }
            />
          ) : (
            <Panel padding="none" className="overflow-hidden">
              <ul className="divide-y divide-border">
                {candidates.map((customer) => (
                  <li key={customer.id}>
                    <Link
                      href={`${base}?${new URLSearchParams({ ...(query ? { q: query } : {}), to: customer.id })}`}
                      className="flex items-center gap-4 px-4 py-4 hover:bg-muted/60 active:bg-muted sm:px-6"
                    >
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                        <UserRound className="size-5" />
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="text-sm font-medium">{customer.name}</span>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {customer.phone}
                        </span>
                      </span>
                      <ArrowLeftRight className="size-4 shrink-0 text-muted-foreground" />
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </Stack>
      )}
    </Stack>
  );
}
