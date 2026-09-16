import Link from 'next/link';
import { requireUser } from '@/lib/auth/authorize';
import { getDashboardData } from '@/lib/data/dashboard';
import { PageHeader } from '@/components/shell/page-header';
import { Button } from '@/components/ui/button';
import { MoneyDisplay } from '@/components/shared/money-display';

function StatTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border px-4 py-3">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

export default async function DashboardPage() {
  const user = await requireUser();
  const data = await getDashboardData(user.organizationId);

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="What's happening in the workshop today."
        actions={
          <>
            <Button size="sm" variant="outline" render={<Link href="/check-in" />}>
              + Check In Vehicle
            </Button>
            <Button size="sm" render={<Link href="/job-cards" />}>
              View Job Cards
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Today's appointments" value={data.todaysAppointments} />
        <StatTile label="Vehicles currently in" value={data.vehiclesCurrentlyIn} />
        <StatTile label="Waiting for approval" value={data.waitingForApproval} />
        <StatTile label="Low-stock parts" value={data.lowStockParts.length} />
      </div>

      <div className="mt-6 grid gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-border px-4 py-3">
          <p className="text-sm font-medium">Customer outstanding</p>
          <p className="mt-1 text-xl font-semibold">
            <MoneyDisplay amount={data.customerOutstanding} />
          </p>
        </div>
        <div className="rounded-lg border border-border px-4 py-3">
          <p className="mb-2 text-sm font-medium">Jobs by status</p>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {Array.from(data.statusCounts.entries()).map(([status, count]) => (
              <li key={status}>
                {status}: <span className="font-medium text-foreground">{count}</span>
              </li>
            ))}
            {data.statusCounts.size === 0 ? <li>No job cards yet.</li> : null}
          </ul>
        </div>
      </div>

      {data.lowStockParts.length > 0 ? (
        <div className="mt-6 rounded-lg border border-border px-4 py-3">
          <p className="mb-2 text-sm font-medium">Low-stock parts</p>
          <ul className="text-sm text-muted-foreground">
            {data.lowStockParts.map((part) => (
              <li key={part.id}>
                {part.name} ({part.sku}) — {part.currentStock} left, reorder at {String(part.reorderLevel)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
