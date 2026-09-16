import Link from 'next/link';
import { requireUser } from '@/lib/auth/authorize';
import { prisma } from '@/lib/prisma';
import { PageHeader } from '@/components/shell/page-header';
import { JobStatusBadge } from '@/components/shared/job-status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const PAGE_SIZE = 25;

export default async function JobCardsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const user = await requireUser();
  const { page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);

  const [jobCards, total] = await Promise.all([
    prisma.jobCard.findMany({
      where: { organizationId: user.organizationId },
      include: { vehicle: { include: { customer: true } } },
      orderBy: { openedAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.jobCard.count({ where: { organizationId: user.organizationId } }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <PageHeader title="Job Cards" description={`${total} total`} />

      {jobCards.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No job cards yet.{' '}
          <Link href="/check-in" className="text-primary underline-offset-4 hover:underline">
            Check in a vehicle
          </Link>{' '}
          to create the first one.
        </p>
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
                <TableRow key={jobCard.id}>
                  <TableCell>
                    <Link href={`/job-cards/${jobCard.id}`} className="font-medium hover:underline">
                      {jobCard.jobNumber}
                    </Link>
                  </TableCell>
                  <TableCell>{jobCard.vehicle.plateNumber}</TableCell>
                  <TableCell>{jobCard.vehicle.customer.name}</TableCell>
                  <TableCell>
                    <JobStatusBadge status={jobCard.status} />
                  </TableCell>
                  <TableCell>{jobCard.openedAt.toLocaleString('en-AE')}</TableCell>
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
