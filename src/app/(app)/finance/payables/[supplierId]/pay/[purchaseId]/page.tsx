import { getAccountChoices } from '@/lib/accounting/reports';
import { getPaymentModeOptions } from '@/lib/accounting/payment-modes';
import { notFound } from 'next/navigation';
import { requireUser, hasPermission } from '@/lib/auth/authorize';
import { AuthError } from '@/lib/auth/authorize';
import { NotFoundError } from '@/lib/errors';
import { getPurchaseForPayment } from '@/lib/finance/supplier-payments';
import { toLocalDateTimeInput } from '@/lib/format';
import { PageHeader, Panel, Stack } from '@/components/layout/primitives';
import { AccessDenied } from '@/components/shared/access-denied';
import { SupplierPaymentForm } from '@/components/finance/supplier-payment-form';

export const dynamic = 'force-dynamic';

export default async function RecordSupplierPaymentPage({
  params,
}: {
  params: Promise<{ supplierId: string; purchaseId: string }>;
}) {
  const user = await requireUser();
  const { supplierId, purchaseId } = await params;
  if (!hasPermission(user, 'supplier_payment.create')) {
    return <AccessDenied what="recording supplier payments" />;
  }

  let purchase;
  try {
    purchase = await getPurchaseForPayment(user, purchaseId);
  } catch (error) {
    if (error instanceof AuthError) return <AccessDenied what="this purchase" />;
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  // A purchase reached through the wrong supplier's URL is not this page.
  if (purchase.supplier.id !== supplierId) notFound();

  const backHref = `/finance/payables/${supplierId}`;

  return (
    <Stack gap="xl" className="animate-in fade-in duration-300">
      <PageHeader
        eyebrow="Supplier payment"
        title="Record a payment"
        description="Money paid to the supplier against one received purchase."
      />

      <Panel className="sm:p-8">
        {purchase.balanceFils === 0 ? (
          <p className="text-sm text-muted-foreground">
            {purchase.number} is already fully paid. Nothing is owed on it.
          </p>
        ) : (
          <SupplierPaymentForm
            moneyAccounts={(await getAccountChoices(user)).money}
            modes={await getPaymentModeOptions(user.organizationId, 'spending')}
            purchase={{
              id: purchase.id,
              number: purchase.number,
              supplierInvoiceNumber: purchase.supplierInvoiceNumber,
              supplierName: purchase.supplier.name,
              balance: purchase.balance,
              balanceFils: purchase.balanceFils,
              received: purchase.received,
              paid: purchase.paid,
            }}
            defaultPaidAt={toLocalDateTimeInput(new Date())}
            backHref={backHref}
          />
        )}
      </Panel>
    </Stack>
  );
}
