import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AuthError, requireUser } from '@/lib/auth/authorize';
import { NotFoundError } from '@/lib/errors';
import { getCreditableInvoice } from '@/lib/billing/credit-notes';
import { formatCalendarDate, formatMoney, localDateString } from '@/lib/format';
import { filsToString, toFils } from '@/lib/money';
import { PageHeader, Panel, Stack } from '@/components/layout/primitives';
import { AccessDenied } from '@/components/shared/access-denied';
import { CreditNoteForm } from '@/components/finance/credit-note-form';

/** Issuing a tax credit note against an invoice. */
export default async function NewCreditNotePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;

  let invoice;
  try {
    invoice = await getCreditableInvoice(user, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    if (error instanceof AuthError) return <AccessDenied what="credit notes" />;
    throw error;
  }
  const due = filsToString(
    Math.max(
      toFils(invoice.totalAmount) -
        toFils(invoice.creditedAmount) -
        toFils(invoice.advanceApplied) -
        toFils(invoice.paid),
      0,
    ),
  );

  return (
    <Stack gap="2xl" className="animate-in fade-in duration-300">
      <PageHeader
        eyebrow={
          <Link href={`/finance/invoices/${invoice.id}`} className="text-primary hover:underline">
            {invoice.invoiceNumber}
          </Link>
        }
        title="Issue a credit note"
        description={`Against ${invoice.invoiceNumber} for ${invoice.customerName}, issued ${formatCalendarDate(invoice.issueDate)} for ${formatMoney(invoice.totalAmount)}${
          toFils(invoice.creditedAmount) > 0
            ? `, of which ${formatMoney(invoice.creditedAmount)} is already credited`
            : ''
        }. The invoice itself stays as issued; the credit note reduces what is owed and the VAT of the period it is dated in.`}
      />
      {invoice.blocker ? (
        <Panel>
          <p className="text-sm text-muted-foreground">{invoice.blocker}</p>
        </Panel>
      ) : (
        <CreditNoteForm
          invoiceId={invoice.id}
          lines={invoice.lines}
          today={localDateString()}
          due={due}
          advanceApplied={invoice.advanceApplied}
        />
      )}
    </Stack>
  );
}
