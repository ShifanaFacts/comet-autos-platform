import Link from 'next/link';
import { HandCoins, Plus } from 'lucide-react';
import { AuthError, requireUser } from '@/lib/auth/authorize';
import { AccessDenied } from '@/components/shared/access-denied';
import { ADVANCE_STATUS_LABEL, listCustomerAdvances } from '@/lib/billing/advances';
import { formatCalendarDate, formatMoney } from '@/lib/format';
import { filsToString, toFils } from '@/lib/money';
import { PageHeader, Panel, Stack } from '@/components/layout/primitives';
import { EmptyState } from '@/components/shared/empty-state';
import { StatusPill } from '@/components/shared/status-pill';
import { SearchField } from '@/components/shared/search-field';
import { LinkButton } from '@/components/shared/link-button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

export const metadata = { title: 'Customer advances' };

const VIEWS = [
  { value: '', label: 'Money held' },
  { value: 'all', label: 'All' },
] as const;

const STATUS_TONE = {
  OPEN: 'warning',
  PARTIALLY_APPLIED: 'warning',
  FULLY_APPLIED: 'success',
  REFUNDED: 'neutral',
  CANCELLED: 'danger',
} as const;

/** Money customers paid before their invoice, and what is still held for them. */
export default async function CustomerAdvancesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; show?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const query = (params.q ?? '').trim();
  const view = params.show === 'all' ? 'all' : '';
  let list;
  try {
    list = await listCustomerAdvances(user, { q: query, status: view ? undefined : 'held' });
  } catch (error) {
    if (error instanceof AuthError) return <AccessDenied what="customer advances" />;
    throw error;
  }
  const href = (show: string) => {
    const search = new URLSearchParams({
      ...(query ? { q: query } : {}),
      ...(show ? { show } : {}),
    });
    const text = search.toString();
    return `/finance/advances${text ? `?${text}` : ''}`;
  };

  return (
    <Stack gap="2xl" className="animate-in fade-in duration-300">
      <PageHeader
        eyebrow="Sales"
        title="Customer advances"
        description="Money a customer pays before their invoice — towards a repair, a part on order. It is held for them until it is applied to their invoice, or paid back. It is not income until the work is invoiced."
        actions={
          list.canReceive ? (
            <LinkButton href="/finance/advances/new" size="lg">
              <Plus />
              Receive advance
            </LinkButton>
          ) : undefined
        }
      />
      <Panel className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">Held for customers</span>
        <span className="text-3xl leading-none font-semibold tabular-nums">
          {formatMoney(list.held)}
        </span>
        <span className="text-xs text-muted-foreground">
          Paid in advance and not yet applied or refunded{view || query ? ' (in this list)' : ''}.
          Owed to the customers in work, or back.
        </span>
      </Panel>
      <Stack gap="base">
        <nav className="flex flex-wrap gap-2" aria-label="Advance views">
          {VIEWS.map((option) => (
            <Link
              key={option.value}
              href={href(option.value)}
              aria-current={view === option.value ? 'page' : undefined}
              className={cn(
                'inline-flex h-9 items-center rounded-lg border px-3 text-sm font-medium',
                view === option.value
                  ? 'border-primary bg-primary/5 text-primary'
                  : 'border-border bg-card hover:bg-muted',
              )}
            >
              {option.label}
            </Link>
          ))}
        </nav>
        <SearchField
          initialQuery={query}
          placeholder="Advance number, customer, plate, job card or note"
          keep={view ? { show: view } : undefined}
        />
        {list.advances.length === 0 ? (
          <EmptyState
            icon={HandCoins}
            title={query ? `No advance matches “${query}”` : 'No advances here'}
            description={
              query
                ? 'Try the advance number or the customer’s name.'
                : 'When a customer pays before their invoice, record it here and apply it when the job is invoiced.'
            }
          />
        ) : (
          <Panel padding="none" className="overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted/40">
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Advance</TableHead>
                    <TableHead className="hidden md:table-cell">Customer · for</TableHead>
                    <TableHead className="text-right">Received</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">Used</TableHead>
                    <TableHead className="text-right">Left</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.advances.map((advance) => {
                    const used = toFils(advance.applied) + toFils(advance.refunded);
                    const isCancelled = advance.status === 'CANCELLED';
                    return (
                      <TableRow key={advance.id}>
                        <TableCell>
                          <Link
                            href={`/finance/advances/${advance.id}`}
                            className="font-semibold hover:underline"
                          >
                            {advance.advanceNumber}
                          </Link>
                          <span className="block text-xs text-muted-foreground">
                            {formatCalendarDate(advance.receivedOn)}
                          </span>
                          <StatusPill tone={STATUS_TONE[advance.status]}>
                            {ADVANCE_STATUS_LABEL[advance.status]}
                          </StatusPill>
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          <span className="font-medium">{advance.customer.name}</span>
                          <span className="block text-xs text-muted-foreground">
                            {[
                              advance.vehicle?.plateNumber,
                              advance.jobCard?.jobNumber,
                              advance.notes,
                            ]
                              .filter(Boolean)
                              .join(' · ') || '—'}
                          </span>
                        </TableCell>
                        <TableCell
                          className={cn(
                            'text-right tabular-nums',
                            isCancelled && 'text-muted-foreground line-through',
                          )}
                        >
                          {formatMoney(advance.amount)}
                        </TableCell>
                        <TableCell className="hidden text-right tabular-nums sm:table-cell">
                          {used ? formatMoney(filsToString(used)) : '—'}
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">
                          {formatMoney(advance.left)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </Panel>
        )}
      </Stack>
    </Stack>
  );
}
