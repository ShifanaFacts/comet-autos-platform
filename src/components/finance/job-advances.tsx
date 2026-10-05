import Link from 'next/link';
import { HandCoins } from 'lucide-react';
import type { AuthenticatedUser } from '@/lib/auth/session';
import { ADVANCE_STATUS_LABEL, getAdvancesFor, type AdvanceTarget } from '@/lib/billing/advances';
import { formatCalendarDate, formatMoney } from '@/lib/format';
import { Panel, Section } from '@/components/layout/primitives';

/**
 * Money the customer paid before their invoice, and a way to take more —
 * on the job card and on the quotation, where a deposit is agreed. There is
 * no separate advances screen: an advance belongs to its job (or, for a
 * quotation without a job card, to the customer and vehicle) and is applied
 * to the invoice when it is issued.
 */
export async function JobAdvances({
  user,
  jobCard,
  quotation,
  open,
}: {
  user: AuthenticatedUser;
  /** On a job card, or a quotation that has one. */
  jobCard?: { id: string; branchId: string };
  /** A quotation without a job card: its customer and vehicle. */
  quotation?: { customerId: string; vehicleId: string | null; branchId: string };
  /** A new advance can still be taken. */
  open: boolean;
}) {
  const target: AdvanceTarget | null = jobCard
    ? { jobCardId: jobCard.id, branchId: jobCard.branchId }
    : quotation
      ? { customerId: quotation.customerId, vehicleId: quotation.vehicleId, branchId: quotation.branchId }
      : null;
  if (!target) return null;
  const data = await getAdvancesFor(user, target);
  if (!data) return null;
  const canReceive = data.canReceive && open;
  if (data.advances.length === 0 && !canReceive) return null;

  const receiveHref = jobCard
    ? `/finance/advances/new?jobCardId=${jobCard.id}`
    : `/finance/advances/new?customerId=${quotation!.customerId}${quotation!.vehicleId ? `&vehicleId=${quotation!.vehicleId}` : ''}`;

  return (
    <Section
      title="Advances"
      description="Deposit paid before the invoice. Applied to the invoice once it is issued."
    >
      <Panel padding="none">
        {data.advances.length ? (
          <ul className="divide-y divide-border text-sm">
            {data.advances.map((advance) => (
              <li key={advance.id}>
                <Link
                  href={`/finance/advances/${advance.id}`}
                  className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-muted/60 sm:px-6"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="font-medium">
                      {`${advance.advanceNumber} · ${formatMoney(advance.amount)}`}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {`${formatCalendarDate(advance.receivedOn)} · ${ADVANCE_STATUS_LABEL[advance.status]}`}
                    </span>
                  </span>
                  <span className="text-right text-xs text-muted-foreground">
                    <span className="block font-semibold text-foreground tabular-nums">
                      {formatMoney(advance.left)}
                    </span>
                    left
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
        {canReceive ? (
          <div
            className={
              data.advances.length
                ? 'border-t border-border px-4 py-3 sm:px-6'
                : 'px-4 py-3 sm:px-6'
            }
          >
            <Link
              href={receiveHref}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-medium hover:bg-muted"
            >
              <HandCoins className="size-4" />
              Receive advance
            </Link>
          </div>
        ) : null}
      </Panel>
    </Section>
  );
}
