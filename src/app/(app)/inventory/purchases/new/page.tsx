import Link from 'next/link';
import { requireUser, hasPermission } from '@/lib/auth/authorize';
import { getPurchaseFormOptions } from '@/lib/inventory/purchases';
import { localDateString } from '@/lib/format';
import { PageHeader, Panel, Stack } from '@/components/layout/primitives';
import { PurchaseForm } from '@/components/inventory/purchase-form';
import { createPurchaseAction } from '../../actions';

export default async function NewPurchasePage({
  searchParams,
}: {
  searchParams: Promise<{ supplier?: string }>;
}) {
  const user = await requireUser();
  const { supplier } = await searchParams;
  const options = await getPurchaseFormOptions(user);
  const preselected = options.suppliers.some((s) => s.id === supplier) ? supplier! : '';

  return (
    <Stack gap="2xl" className="animate-in fade-in duration-300">
      <PageHeader
        eyebrow={
          <Link
            href="/inventory/purchases"
            className="tracking-normal normal-case hover:text-foreground"
          >
            ← Purchases
          </Link>
        }
        title="New purchase"
        description="Enter the supplier invoice. Receive it now if the parts arrived with it, or save a draft and receive later."
      />
      <Panel className="w-full max-w-5xl sm:p-8">
        <PurchaseForm
          action={createPurchaseAction}
          parts={options.parts}
          suppliers={options.suppliers}
          defaultVat={options.defaultVat}
          today={localDateString()}
          initial={
            preselected
              ? {
                  supplierId: preselected,
                  supplierInvoiceNumber: '',
                  supplierInvoiceDate: localDateString(),
                  notes: '',
                  items: [],
                }
              : undefined
          }
          isNew
          canReceive={hasPermission(user, 'purchase.receive')}
          cancelHref="/inventory/purchases"
        />
      </Panel>
    </Stack>
  );
}
