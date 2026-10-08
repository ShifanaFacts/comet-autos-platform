import Link from 'next/link';
import { ArrowRightLeft } from 'lucide-react';
import { AuthError, requireUser } from '@/lib/auth/authorize';
import { getTransferAccounts, listMoneyTransfers } from '@/lib/finance/money';
import { formatCalendarDate, formatDateTime, formatMoney, localDateString } from '@/lib/format';
import { PageHeader, Panel, Section, Stack } from '@/components/layout/primitives';
import { AccessDenied } from '@/components/shared/access-denied';
import { EmptyState } from '@/components/shared/empty-state';
import { Pagination } from '@/components/shared/pagination';
import { loadPage, pageFrom } from '@/lib/pagination';
import { StatusPill } from '@/components/shared/status-pill';
import { MoneyTransferForm, VoidTransferButton } from '@/components/finance/money-transfer-form';

export const metadata = { title: 'Money transfers' };

/** Moving money between the workshop's own accounts, and every move made. */
export default async function MoneyTransfersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  let list;
  let info;
  let accounts;
  try {
    [{ result: list, info }, accounts] = await Promise.all([
      loadPage(pageFrom(params.page), (skip, take) => listMoneyTransfers(user, take, skip)),
      getTransferAccounts(user),
    ]);
  } catch (error) {
    if (error instanceof AuthError) return <AccessDenied what="money transfers" />;
    throw error;
  }

  return (
    <Stack gap="2xl" className="animate-in fade-in duration-300">
      <PageHeader
        eyebrow={
          <Link href="/finance/money" className="text-primary hover:underline">
            Money
          </Link>
        }
        title="Money transfers"
        description="Money moved between the workshop's own accounts — cash on hand into the petty-cash box, the day's takings into the bank. Nothing is earned or spent: it only changes where the money is."
      />

      {list.canTransfer ? (
        <Section title="Move money">
          <Panel>
            <MoneyTransferForm
              accounts={accounts.map((account) => ({
                id: account.id,
                label: account.label,
                code: account.code,
                balance: account.balance,
              }))}
              today={localDateString()}
            />
          </Panel>
        </Section>
      ) : null}

      <Section title="Transfers made">
        {list.transfers.length === 0 ? (
          <EmptyState
            icon={ArrowRightLeft}
            title="No transfers yet"
            description="Each time money moves between the cash drawer, the petty-cash box and the bank, it is listed here."
          />
        ) : (
          <Panel padding="none" className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="bg-muted/40 text-left text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
                  <tr>
                    <th className="w-28 px-4 py-3 pl-6">Date</th>
                    <th className="px-2 py-3">Moved</th>
                    <th className="w-32 px-2 py-3 text-right">Amount</th>
                    <th className="w-0 px-4 py-3 pr-6" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {list.transfers.map((transfer) => {
                    const isVoid = transfer.status === 'VOID';
                    return (
                      <tr
                        key={transfer.id}
                        className={isVoid ? 'text-muted-foreground' : undefined}
                      >
                        <td className="px-4 py-3 pl-6 tabular-nums whitespace-nowrap">
                          {formatCalendarDate(transfer.transferredOn)}
                        </td>
                        <td className="px-2 py-3">
                          <span className="font-medium">
                            {`${transfer.fromAccount.accountName} to ${transfer.toAccount.accountName}`}
                          </span>{' '}
                          {isVoid ? <StatusPill tone="neutral">Void</StatusPill> : null}
                          <span className="block text-xs text-muted-foreground">
                            {`${transfer.transferNumber}${transfer.reference ? ` · ref ${transfer.reference}` : ''} · ${transfer.createdBy.fullName}, ${formatDateTime(transfer.createdAt)}`}
                          </span>
                          {transfer.notes ? (
                            <span className="block text-xs text-muted-foreground">
                              {transfer.notes}
                            </span>
                          ) : null}
                          {isVoid && transfer.voidReason ? (
                            <span className="block text-xs">{`Voided: ${transfer.voidReason}`}</span>
                          ) : null}
                        </td>
                        <td
                          className={
                            isVoid
                              ? 'px-2 py-3 text-right tabular-nums line-through'
                              : 'px-2 py-3 text-right font-semibold tabular-nums'
                          }
                        >
                          {formatMoney(transfer.amount.toString())}
                        </td>
                        <td className="px-4 py-3 pr-6 text-right">
                          {list.canVoid && !isVoid ? (
                            <VoidTransferButton
                              transferId={transfer.id}
                              label={transfer.transferNumber}
                            />
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination
              info={info}
              basePath="/finance/money/transfers"
              params={params}
              noun="transfers"
            />
          </Panel>
        )}
      </Section>
    </Stack>
  );
}
