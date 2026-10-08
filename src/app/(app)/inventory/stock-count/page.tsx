import Link from 'next/link';
import { AuthError, requireUser } from '@/lib/auth/authorize';
import { getStockCountSheet, type StockCountSheet } from '@/lib/inventory/stock-count';
import { formatCalendarDate, formatMoney, localDateString } from '@/lib/format';
import { PageHeader, Panel, Section, Stack } from '@/components/layout/primitives';
import { AccessDenied } from '@/components/shared/access-denied';
import { StockCountForm } from '@/components/inventory/stock-count-form';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

/**
 * Counting the shelves and correcting the system to them
 * (lib/inventory/stock-count.ts), with what the stock is worth beside what
 * the books say it is worth.
 */
export default async function StockCountPage({
  searchParams,
}: {
  searchParams: Promise<{ posted?: string; corrected?: string; counted?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  let sheet: StockCountSheet;
  try {
    sheet = await getStockCountSheet(user);
  } catch (error) {
    if (error instanceof AuthError) return <AccessDenied what="the stock count" />;
    throw error;
  }
  const { value } = sheet;

  return (
    <Stack gap="2xl" className="animate-in fade-in duration-300">
      <PageHeader
        eyebrow={
          <Link href="/inventory" className="tracking-normal normal-case hover:text-foreground">
            Inventory
          </Link>
        }
        title="Stock count"
        description={`Count what is on the shelves at ${sheet.branch.name} and the system corrects itself to it — each difference at the part's cost.`}
      />

      {params.posted ? (
        <p className="rounded-xl border border-success/40 bg-success/10 px-4 py-3 text-sm font-medium text-success">
          {`Count ${params.posted} posted: ${params.counted ?? 0} part${params.counted === '1' ? '' : 's'} counted, ${params.corrected ?? 0} corrected.`}
        </p>
      ) : null}

      <Panel className="grid gap-6 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Stock at cost</span>
          <span className="text-2xl leading-none font-semibold tabular-nums">
            {formatMoney(value.stock)}
          </span>
          <span className="text-xs text-muted-foreground">What the system holds × each cost</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">
            In the books{value.account ? ` (${value.account.accountCode})` : ''}
          </span>
          <span
            className={cn(
              'text-2xl leading-none font-semibold tabular-nums',
              value.booksNegative && 'text-destructive',
            )}
          >
            {value.booksNegative ? '−' : ''}
            {formatMoney(value.books)}
          </span>
          <span className="text-xs text-muted-foreground">
            {value.account?.accountName ?? 'Inventory'}
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Difference</span>
          <span
            className={cn(
              'text-2xl leading-none font-semibold tabular-nums',
              value.differenceSign !== 0 && 'text-warning',
            )}
          >
            {formatMoney(value.difference)}
          </span>
          <span className="text-xs text-muted-foreground">
            {value.differenceSign === 0
              ? 'The books agree with the stock.'
              : value.differenceSign > 0
                ? 'The stock is worth more than the books say.'
                : 'The books say more than the stock is worth.'}
          </span>
        </div>
      </Panel>
      {value.differenceSign !== 0 ? (
        <p className="text-sm text-muted-foreground">
          Count the shelves first: the count corrects the quantities, and the books with them. What
          is still different after that comes from costs recorded before parts were tied to stock
          — your accountant clears it with one journal entry, Inventory against Inventory
          adjustments.
        </p>
      ) : null}

      <Section title="Count">
        <Panel>
          {sheet.canPost ? (
            <StockCountForm
              today={localDateString()}
              lines={sheet.lines.map((line) => ({
                id: line.id,
                sku: line.sku,
                name: line.name,
                category: line.category,
                unitOfMeasure: line.unitOfMeasure,
                cost: line.cost,
                onHandMilli: line.onHandMilli,
              }))}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              Someone allowed to adjust stock posts a count.
            </p>
          )}
        </Panel>
      </Section>

      {sheet.recent.length ? (
        <Section title="Earlier counts">
          <Panel padding="none">
            <ul className="divide-y divide-border">
              {sheet.recent.map((count) => (
                <li
                  key={count.id}
                  className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3 text-sm sm:px-6"
                >
                  <span className="font-medium">
                    {count.countNumber} · {formatCalendarDate(count.countedOn)}
                  </span>
                  <span className="text-muted-foreground">
                    {count.partsCounted} counted · {count._count.movements} corrected ·{' '}
                    {count.createdBy.fullName}
                    {count.note ? ` · ${count.note}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        </Section>
      ) : null}
    </Stack>
  );
}
