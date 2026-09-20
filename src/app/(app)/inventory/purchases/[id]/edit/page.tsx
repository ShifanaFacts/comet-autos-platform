import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/authorize';
import { NotFoundError } from '@/lib/errors';
import { getPurchaseForEdit, getPurchaseFormOptions } from '@/lib/inventory/purchases';
import { localDateString } from '@/lib/format';
import { formatMilli, signedToMilli } from '@/lib/money';
import { PageHeader, Panel, Stack } from '@/components/layout/primitives';
import { PurchaseForm } from '@/components/inventory/purchase-form';
import { updatePurchaseAction } from '../../../actions';

export default async function EditPurchasePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  let purchase;
  try {
    purchase = await getPurchaseForEdit(user, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  if (purchase.status !== 'DRAFT') redirect(`/inventory/purchases/${purchase.id}`);
  const options = await getPurchaseFormOptions(user);

  return (
    <Stack gap="2xl" className="animate-in fade-in duration-300">
      <PageHeader
        eyebrow={
          <Link
            href={`/inventory/purchases/${purchase.id}`}
            className="tracking-normal normal-case hover:text-foreground"
          >
            ← {purchase.purchaseNumber}
          </Link>
        }
        title="Edit draft purchase"
      />
      <Panel className="w-full max-w-5xl sm:p-8">
        <PurchaseForm
          action={updatePurchaseAction.bind(null, purchase.id)}
          parts={options.parts}
          suppliers={options.suppliers}
          defaultVat={options.defaultVat}
          today={localDateString()}
          initial={{
            supplierId: purchase.supplierId,
            supplierInvoiceNumber: purchase.supplierInvoiceNumber ?? '',
            supplierInvoiceDate: purchase.supplierInvoiceDate
              ? purchase.supplierInvoiceDate.toISOString().slice(0, 10)
              : '',
            notes: purchase.notes ?? '',
            items: purchase.items.map((item) => ({
              partId: item.partId,
              quantity: formatMilli(signedToMilli(item.quantityOrdered)),
              unitCost: item.unitCost.toFixed(2),
              taxRate: item.taxRate?.toString() ?? options.defaultVat,
            })),
          }}
          isNew={false}
          canReceive={false}
          cancelHref={`/inventory/purchases/${purchase.id}`}
        />
      </Panel>
    </Stack>
  );
}
