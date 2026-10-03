import Link from 'next/link';
import { HandCoins } from 'lucide-react';
import { AuthError, requireUser } from '@/lib/auth/authorize';
import { getOwnerMoneyForm, listOwnerMoney } from '@/lib/finance/owner-money';
import { formatCalendarDate, formatMoney } from '@/lib/format';
import { Grid, PageHeader, Panel, Section, Stack } from '@/components/layout/primitives';
import { AccessDenied } from '@/components/shared/access-denied';
import { EmptyState } from '@/components/shared/empty-state';
import { StatusPill } from '@/components/shared/status-pill';
import {
  AddPartnerForm,
  OwnerMoneyForm,
  VoidOwnerMoneyButton,
} from '@/components/finance/owner-money-form';

export const metadata = { title: "Owner's money" };

/** An owner putting money into the business or taking it out, and every one recorded. */
export default async function OwnerMoneyPage() {
  const user = await requireUser();
  let list;
  let options;
  try {
    [list, options] = await Promise.all([listOwnerMoney(user), getOwnerMoneyForm(user)]);
  } catch (error) {
    if (error instanceof AuthError) return <AccessDenied what="owner's money" />;
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
        title="Owner's money"
        description="Money an owner puts into the business — to stay, or as a loan — and money an owner takes out for themselves. None of it is income or an expense, so profit never changes."
      />

      <Grid className="sm:grid-cols-3">
        {[
          ['Put in (capital)', list.totals.capitalIn],
          ['Lent to the business', list.totals.loansIn],
          ['Taken out (drawings)', list.totals.drawings],
        ].map(([label, amount]) => (
          <Panel key={label}>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{formatMoney(amount)}</p>
          </Panel>
        ))}
      </Grid>

      <Section
        title="Partners"
        description="The business's owners. Each one's money put in, lent and taken out is kept against their name."
      >
        <Panel padding="none" className="overflow-hidden">
          {list.partners.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-160 text-sm">
                <thead className="bg-muted/40 text-left text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
                  <tr>
                    <th className="px-4 py-3 pl-6">Partner</th>
                    <th className="w-32 px-2 py-3 text-right">Put in</th>
                    <th className="w-32 px-2 py-3 text-right">Lent</th>
                    <th className="w-32 px-2 py-3 text-right">Taken out</th>
                    <th className="w-36 px-4 py-3 pr-6 text-right">In the business</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {list.partners.map((partner) => (
                    <tr key={partner.id}>
                      <td className="px-4 py-3 pl-6 font-medium">{partner.name}</td>
                      <td className="px-2 py-3 text-right tabular-nums">
                        {formatMoney(partner.capitalIn)}
                      </td>
                      <td className="px-2 py-3 text-right tabular-nums">
                        {formatMoney(partner.loansIn)}
                      </td>
                      <td className="px-2 py-3 text-right tabular-nums">
                        {formatMoney(partner.drawings)}
                      </td>
                      <td className="px-4 py-3 pr-6 text-right font-semibold tabular-nums">
                        {formatMoney(partner.net)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="px-4 py-4 text-sm text-muted-foreground sm:px-6">
              No partners yet — add each one by name.
            </p>
          )}
          {list.canRecord ? (
            <div className="border-t border-border px-4 py-4 sm:px-6">
              <AddPartnerForm />
            </div>
          ) : null}
        </Panel>
      </Section>

      {list.canRecord ? (
        <Section title="Record owner's money">
          <Panel>
            <OwnerMoneyForm options={options} />
          </Panel>
        </Section>
      ) : null}

      <Section title="Recorded">
        {list.rows.length === 0 ? (
          <EmptyState
            icon={HandCoins}
            title="Nothing recorded yet"
            description="Each time an owner puts money in or takes it out, it is listed here with its journal entry."
          />
        ) : (
          <Panel padding="none" className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-180 text-sm">
                <thead className="bg-muted/40 text-left text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
                  <tr>
                    <th className="w-28 px-4 py-3 pl-6">Date</th>
                    <th className="px-2 py-3">What</th>
                    <th className="w-36 px-2 py-3">Journal entry</th>
                    <th className="w-32 px-2 py-3 text-right">Amount</th>
                    <th className="w-0 px-4 py-3 pr-6" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {list.rows.map((row) => {
                    const isVoid = row.status === 'VOID';
                    return (
                      <tr key={row.id} className={isVoid ? 'text-muted-foreground' : undefined}>
                        <td className="px-4 py-3 pl-6 tabular-nums whitespace-nowrap">
                          {formatCalendarDate(row.movedOn)}
                        </td>
                        <td className="px-2 py-3">
                          <span className="font-medium">{row.label}</span>{' '}
                          {isVoid ? <StatusPill tone="neutral">Void</StatusPill> : null}
                          <span className="block text-xs text-muted-foreground">
                            {`${row.entryNumber} · ${row.kind === 'DRAWINGS' ? 'from' : 'into'} ${row.account.accountName}${row.partner ? ` · ${row.partner.name}` : row.owner ? ` · ${row.owner.fullName}` : ''}${row.reference ? ` · ref ${row.reference}` : ''}`}
                          </span>
                          {row.notes ? (
                            <span className="block text-xs text-muted-foreground">{row.notes}</span>
                          ) : null}
                          {isVoid && row.voidReason ? (
                            <span className="block text-xs">{`Voided: ${row.voidReason}`}</span>
                          ) : null}
                        </td>
                        <td className="px-2 py-3 text-xs">
                          {row.journalEntry ? (
                            <Link
                              href="/finance/accounting?view=journal"
                              className="font-mono text-primary hover:underline"
                            >
                              {row.journalEntry}
                            </Link>
                          ) : (
                            '—'
                          )}
                          {row.reversedBy ? (
                            <span className="block text-muted-foreground">
                              reversed by {row.reversedBy}
                            </span>
                          ) : null}
                        </td>
                        <td
                          className={
                            isVoid
                              ? 'px-2 py-3 text-right tabular-nums line-through'
                              : 'px-2 py-3 text-right font-semibold tabular-nums'
                          }
                        >
                          {row.kind === 'DRAWINGS' ? '−' : ''}
                          {formatMoney(row.amount.toString())}
                        </td>
                        <td className="px-4 py-3 pr-6 text-right">
                          {list.canVoid && !isVoid ? (
                            <VoidOwnerMoneyButton id={row.id} label={row.entryNumber} />
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
        )}
      </Section>
    </Stack>
  );
}
