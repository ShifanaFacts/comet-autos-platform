import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { hasPermission, requireUser } from '@/lib/auth/authorize';
import { getAccountChoices } from '@/lib/accounting/reports';
import { localDateString } from '@/lib/format';
import { PageHeader, Panel, Stack } from '@/components/layout/primitives';
import { AccessDenied } from '@/components/shared/access-denied';
import { JournalEntryForm } from '@/components/accounting/journal-entry-form';

export const metadata = { title: 'New journal entry' };

/** A journal entry made by hand — for the accountant. */
export default async function NewJournalEntryPage() {
  const user = await requireUser();
  if (!hasPermission(user, 'accounting.create')) return <AccessDenied what="the accounts" />;
  const accounts = await getAccountChoices(user);
  // The parties a line on a customer or supplier account can name: those in use.
  const [customers, suppliers] = await Promise.all([
    prisma.customer.findMany({
      where: { organizationId: user.organizationId, isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, phone: true },
    }),
    prisma.supplier.findMany({
      where: { organizationId: user.organizationId, isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, taxNumber: true },
    }),
  ]);

  return (
    <Stack gap="2xl" className="animate-in fade-in duration-300">
      <PageHeader
        eyebrow={
          <Link
            href="/finance/accounting?view=journal"
            className="tracking-normal normal-case hover:text-foreground"
          >
            Journal
          </Link>
        }
        title="New journal entry"
        description="For what no screen records: opening balances, the owner's capital and drawings, bank charges, depreciation, card takings settled into the bank, an amount for one customer or supplier, or moving an amount between accounts. Invoices, payments, expenses, stock and payroll book themselves."
      />
      <Panel className="w-full p-4 sm:p-8">
        <JournalEntryForm
          accounts={accounts.all}
          customers={customers.map((c) => ({ id: c.id, name: c.name, detail: c.phone }))}
          suppliers={suppliers.map((s) => ({
            id: s.id,
            name: s.name,
            detail: s.taxNumber ? `TRN ${s.taxNumber}` : null,
          }))}
          today={localDateString()}
        />
      </Panel>
    </Stack>
  );
}
