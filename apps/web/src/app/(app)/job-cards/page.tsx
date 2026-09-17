import Link from 'next/link';
import { ClipboardList } from 'lucide-react';
import { requireUser } from '@/lib/auth/authorize';
import { prisma } from '@/lib/prisma';
import { PageHeader } from '@/components/shell/page-header';
import { JobStatusBadge } from '@/components/shared/job-status-badge';
import { EmptyState } from '@/components/shared/empty-state';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import type { JobCardStatus } from '@/generated/prisma/enums';
import { JobCardFilters } from './job-card-filters';

const PAGE_SIZE = 25;

export default async function JobCardsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string; q?: string }>;
}) {
  const user = await requireUser();
  const { page: pageParam, status, q } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);
  const query = q?.trim() ?? '';

  const where = {
    organizationId: user.organizationId,
    ...(status ? { status: status as JobCardStatus } : {}),
    ...(query
      ? {
          OR: [
            { jobNumber: { contains: query, mode: 'insensitive' as const } },
            { vehicle: { plateNumber: { contains: query, mode: 'insensitive' as const } } },
            { vehicle: { customer: { name: { contains: query, mode: 'insensitive' as const } } } },
          ],
        }
      : {}),
  };

  const [jobCards, total, unfilteredTotal] = await Promise.all([
    prisma.jobCard.findMany({
      where,
      include: { vehicle: { include: { customer: true } } },
      orderBy: { openedAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.jobCard.count({ where }),
    prisma.jobCard.count({ where: { organizationId: user.organizationId } }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const isFiltered = Boolean(status || query);

  return (
    <div className="animate-in fade-in duration-300">
      <PageHeader
        title="Job Cards"
        description={`${total} of ${unfilteredTotal} total`}
        actions={
          <Button size="sm" render={<Link href="/check-in" />}>
            + Check In Vehicle
          </Button>
        }
      />

      <JobCardFilters status={status ?? ''} q={query} />

      {jobCards.length === 0 ? (
        isFiltered ? (
          <EmptyState
            icon={ClipboardList}
            title="No job cards match your filters"
            description="Try a different search or clear the status filter."
          />
        ) : (
          <EmptyState
            icon={ClipboardList}
            title="No job cards yet"
            description="Check in a vehicle to create the first one."
            action={
              <Button size="sm" render={<Link href="/check-in" />}>
                Check In Vehicle
              </Button>
            }
          />
        )
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job #</TableHead>
                <TableHead>Vehicle</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Opened</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobCards.map((jobCard) => (
                <TableRow key={jobCard.id} className="relative cursor-pointer">
                  <TableCell>
                    <Link
                      href={`/job-cards/${jobCard.id}`}
                      className="font-medium after:absolute after:inset-0 hover:underline"
                    >
                      {jobCard.jobNumber}
                    </Link>
                  </TableCell>
                  <TableCell>{jobCard.vehicle.plateNumber}</TableCell>
                  <TableCell>{jobCard.vehicle.customer.name}</TableCell>
                  <TableCell>
                    <JobStatusBadge status={jobCard.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {jobCard.openedAt.toLocaleString('en-AE', { dateStyle: 'medium', timeStyle: 'short' })}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {totalPages > 1 ? (
            <div className="mt-4 flex items-center gap-3 text-sm text-muted-foreground">
              {page > 1 ? (
                <Link href={`/job-cards?page=${page - 1}`} className="hover:underline">
                  Previous
                </Link>
              ) : null}
              <span>
                Page {page} of {totalPages}
              </span>
              {page < totalPages ? (
                <Link href={`/job-cards?page=${page + 1}`} className="hover:underline">
                  Next
                </Link>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
