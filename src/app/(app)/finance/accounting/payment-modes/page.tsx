import Link from 'next/link';
import { Info, Wallet } from 'lucide-react';
import { hasPermission, requireUser } from '@/lib/auth/authorize';
import { listPaymentModes } from '@/lib/accounting/payment-modes';
import { PageHeader, Panel, Section, Stack } from '@/components/layout/primitives';
import { AccessDenied } from '@/components/shared/access-denied';
import { InlineForm } from '@/components/shared/inline-form';
import { StatusPill } from '@/components/shared/status-pill';
import {
  EditPaymentModeButton,
  NewPaymentModeForm,
} from '@/components/accounting/payment-mode-forms';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export default async function PaymentModesPage() {
  const user = await requireUser();
  if (!hasPermission(user, 'settings.view')) return <AccessDenied what="the accounts" />;
  const { modes, accounts } = await listPaymentModes(user);
  const canEdit = hasPermission(user, 'settings.edit');

  return (
    <Stack gap="2xl" className="animate-in fade-in duration-300">
      <PageHeader
        eyebrow={
          <Link href="/finance/accounting?view=accounts" className="hover:text-foreground">
            Accounting
          </Link>
        }
        title="Payment modes"
        description="How money comes in and goes out — each mode tied to the cash, bank or card account it posts to. Choosing a mode on a receipt or payment puts the money in the right account."
      />

      {canEdit ? (
        <Panel padding="none" className="overflow-hidden">
          <InlineForm
            label="Add a payment mode"
            hint="One per real account: a second bank, a card terminal, petty cash."
            icon={<Wallet className="size-4" />}
          >
            <NewPaymentModeForm accounts={accounts} />
          </InlineForm>
        </Panel>
      ) : null}

      <Section title="Modes">
        <Panel padding="none" className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-muted/40 text-left text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
                <tr>
                  <th className="px-4 py-3 pl-6">Mode</th>
                  <th className="px-2 py-3">Kind</th>
                  <th className="px-2 py-3">Ledger account</th>
                  <th className="px-2 py-3">Used for</th>
                  <th className="w-0 px-4 py-3 pr-6" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {modes.map((mode) => (
                  <tr key={mode.id} className={cn(!mode.isActive && 'text-muted-foreground')}>
                    <td className="px-4 py-3 pl-6">
                      <span className="flex flex-wrap items-center gap-2 font-medium">
                        {mode.name}
                        {mode.isDefault ? <StatusPill tone="primary">Default</StatusPill> : null}
                        {mode.isActive ? null : <StatusPill tone="neutral">Retired</StatusPill>}
                      </span>
                      {mode.requiresReference ? (
                        <span className="block text-xs text-muted-foreground">
                          Reference required
                        </span>
                      ) : null}
                    </td>
                    <td className="px-2 py-3">{mode.methodLabel}</td>
                    <td className="px-2 py-3">
                      {mode.accountName}
                      {mode.accountRetired ? (
                        <span className="block text-xs text-danger">
                          The account is retired — the mode is not offered.
                        </span>
                      ) : null}
                    </td>
                    <td className="px-2 py-3 text-muted-foreground">
                      {[mode.forReceipts ? 'Receipts' : null, mode.forPayments ? 'Payments' : null]
                        .filter(Boolean)
                        .join(' · ')}
                    </td>
                    <td className="px-4 py-3 pr-6 text-right">
                      {canEdit ? <EditPaymentModeButton mode={mode} accounts={accounts} /> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" />A mode is never deleted — retire it instead.
          Receipts and payments keep the account they were posted to, whatever happens to the mode
          later.
        </p>
      </Section>
    </Stack>
  );
}
