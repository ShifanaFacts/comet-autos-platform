import Link from 'next/link';
import { notFound } from 'next/navigation';
import { TriangleAlert } from 'lucide-react';
import { AuthError, requireUser } from '@/lib/auth/authorize';
import { NotFoundError } from '@/lib/errors';
import { getMoneyAccountActivity } from '@/lib/finance/money';
import { formatCalendarDate, formatMoney } from '@/lib/format';
import { PageHeader, Panel, Stack } from '@/components/layout/primitives';
import { AccessDenied } from '@/components/shared/access-denied';
import { EmptyState } from '@/components/shared/empty-state';

const money = (value: string) =>
  value.startsWith('-') ? `−${formatMoney(value.slice(1))}` : formatMoney(value);

/** One money account: every movement in and out, newest first, with the balance after each. */
export default async function MoneyAccountPage({
  params,
}: {
  params: Promise<{ accountId: string }>;
}) {
  const user = await requireUser();
  const { accountId } = await params;
  let activity;
  try {
    activity = await getMoneyAccountActivity(user, accountId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    if (error instanceof AuthError) return <AccessDenied what="money" />;
    throw error;
  }
  const { account, rows } = activity;
  const isCard = account.kind === 'company-card';

  return (
    <Stack gap="2xl" className="animate-in fade-in duration-300">
      <PageHeader
        eyebrow={
          <Link href="/finance/money" className="text-primary hover:underline">
            {`Money · ${account.kindLabel}`}
          </Link>
        }
        title={account.name}
        description={`${isCard ? 'Owed on it' : 'In it'} now: ${money(account.balance)}. Every movement, newest first.`}
      />

      {account.belowZero ? (
        <p className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/5 px-4 py-3 text-sm text-warning sm:px-6">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          Below zero: more has been paid out of it than was ever recorded going in. What it held at
          the start (its opening balance), or money put into it, has not been entered yet.
        </p>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          title="Nothing yet"
          description="Money received into or paid from this account will be listed here."
        />
      ) : (
        <Panel padding="none" className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-muted/40 text-left text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
                <tr>
                  <th className="w-28 px-4 py-3 pl-6">Date</th>
                  <th className="px-2 py-3">What</th>
                  <th className="w-32 px-2 py-3 text-right">{isCard ? 'Paid off' : 'Money in'}</th>
                  <th className="w-32 px-2 py-3 text-right">{isCard ? 'Spent' : 'Money out'}</th>
                  <th className="w-36 px-4 py-3 pr-6 text-right">{isCard ? 'Owed' : 'Balance'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="px-4 py-2.5 pl-6 tabular-nums whitespace-nowrap">
                      {formatCalendarDate(row.date)}
                    </td>
                    <td className="px-2 py-2.5">
                      {row.href ? (
                        <Link href={row.href} className="hover:underline">
                          {row.description}
                        </Link>
                      ) : (
                        row.description
                      )}
                      {row.entryNumber ? (
                        <span className="ml-2 font-mono text-xs text-muted-foreground">
                          {row.entryNumber}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-2 py-2.5 text-right tabular-nums">
                      {row.moneyIn ? formatMoney(row.moneyIn) : ''}
                    </td>
                    <td className="px-2 py-2.5 text-right tabular-nums">
                      {row.moneyOut ? formatMoney(row.moneyOut) : ''}
                    </td>
                    <td className="px-4 py-2.5 pr-6 text-right font-medium tabular-nums">
                      {money(row.balance)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </Stack>
  );
}
