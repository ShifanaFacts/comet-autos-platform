import Link from 'next/link';
import { HandCoins } from 'lucide-react';
import type { AuthenticatedUser } from '@/lib/auth/session';
import { ADVANCE_STATUS_LABEL, getJobAdvances } from '@/lib/billing/advances';
import { formatCalendarDate, formatMoney } from '@/lib/format';
import { Panel, Section } from '@/components/layout/primitives';

/**
 * Money the customer paid towards this job before its invoice, and a way to
 * take more. Applied to the job's invoice from the invoice or the advance.
 */
export async function JobAdvances({
  user,
  jobCard,
  open,
}: {
  user: AuthenticatedUser;
  jobCard: { id: string; branchId: string };
  /** Still in the workshop: a new advance can be taken towards it. */
  open: boolean;
}) {
  const data = await getJobAdvances(user, jobCard);
  if (!data) return null;
  const canReceive = data.canReceive && open;
  if (data.advances.length === 0 && !canReceive) return null;

  return (
    <Section
      title="Advances"
      description="Paid towards this job before its invoice. Applied to the invoice once it is issued."
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
              href={`/finance/advances/new?jobCardId=${jobCard.id}`}
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
