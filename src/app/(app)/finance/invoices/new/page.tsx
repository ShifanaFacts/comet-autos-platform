import { notFound } from 'next/navigation';
import { getPaymentModeOptions } from '@/lib/accounting/payment-modes';
import { getTaxCodeOptions } from '@/lib/accounting/tax-codes';
import { getPartCatalog } from '@/lib/inventory/part-options';
import { hasPermission, requirePermission, requireUser } from '@/lib/auth/authorize';
import { prisma } from '@/lib/prisma';
import { resolveDefaultVatRate } from '@/lib/tax';
import { getAccountChoices } from '@/lib/accounting/reports';
import { getCustomerOptions, type CustomerOption } from '@/lib/customers/picker';
import { editableBill, editableLine } from '@/lib/billing/editable-lines';
import { getHeldAdvances } from '@/lib/billing/advances';
import { jobHasFittedParts } from '@/lib/billing/part-lines';
import { PageHeader, Panel, Stack } from '@/components/layout/primitives';
import { NewInvoiceForm, type QuotationChoice } from './invoice-form';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{
    customer?: string;
    quotation?: string;
    workOrder?: string;
    /** "now": a sales receipt — the customer pays on the spot. */
    pay?: string;
  }>;
}) {
  const user = await requireUser();
  requirePermission(user, 'invoice.create', { branchId: user.primaryBranchId ?? undefined });
  const params = await searchParams;

  // Billing a job card: its customer and vehicle are already known.
  let workOrder: { id: string; customerId: string; vehicleId: string } | null = null;
  if (params.workOrder && UUID.test(params.workOrder)) {
    const job = await prisma.jobCard.findFirst({
      where: { id: params.workOrder, organizationId: user.organizationId },
      select: { id: true, branchId: true, customerId: true, vehicleId: true },
    });
    if (!job) notFound();
    requirePermission(user, 'invoice.create', { branchId: job.branchId });
    workOrder = { id: job.id, customerId: job.customerId, vehicleId: job.vehicleId };
  }

  // Billing a quotation: its customer, vehicle and job card come with it.
  let quotation: QuotationChoice | null = null;
  if (params.quotation && UUID.test(params.quotation)) {
    const estimate = await prisma.estimate.findFirst({
      where: { id: params.quotation, organizationId: user.organizationId },
      select: {
        id: true,
        estimateNumber: true,
        status: true,
        totalAmount: true,
        branchId: true,
        customerId: true,
        vehicleId: true,
        jobCardId: true,
        discountType: true,
        discountValue: true,
        customer: { select: { name: true } },
        items: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
        _count: { select: { items: true } },
      },
    });
    if (!estimate) notFound();
    requirePermission(user, 'invoice.create', { branchId: estimate.branchId });
    quotation = {
      id: estimate.id,
      estimateNumber: estimate.estimateNumber,
      totalAmount: estimate.totalAmount.toString(),
      lineCount: estimate._count.items,
      customerId: estimate.customerId,
      customerName: estimate.customer.name,
      vehicleId: estimate.vehicleId,
      jobCardId: estimate.jobCardId,
      // Its lines and discount, as the form edits them; billed as quoted unless changed.
      lines: estimate.items.map((item, index) => editableLine(item, `quoted-${index}`, '0')),
      bill: editableBill(estimate),
    };
  }

  const customerId =
    quotation?.customerId ??
    workOrder?.customerId ??
    (params.customer && UUID.test(params.customer) ? params.customer : null);
  const accounts = await getAccountChoices(user);
  let initialCustomer: CustomerOption | null = null;
  if (customerId) {
    [initialCustomer = null] = await getCustomerOptions(user, [customerId]);
  }
  const initialAdvances = initialCustomer ? await getHeldAdvances(user, initialCustomer.id) : null;

  return (
    <Stack gap="2xl" className="animate-in fade-in duration-300">
      <PageHeader
        eyebrow="Invoices"
        title={params.pay === 'now' ? 'New sales receipt' : 'New invoice'}
        description={
          quotation
            ? 'Billing a quotation — its lines and discounts are filled in below. Change anything before issuing; left as they are, they are billed exactly as quoted.'
            : 'Bill a customer for work done. A job card is not needed — link one only if you want to.'
        }
      />
      <Panel className="w-full sm:p-8">
        <NewInvoiceForm
          initialCustomer={initialCustomer}
          initialWorkOrder={workOrder}
          quotation={quotation}
          defaultVatRate={await resolveDefaultVatRate(user.organizationId)}
          taxCodes={await getTaxCodeOptions(user.organizationId, 'sales')}
          catalog={await getPartCatalog(user, { forSale: true })}
          partsFitted={await jobHasFittedParts(user.organizationId, workOrder?.id ?? quotation?.jobCardId ?? null)}
          modes={await getPaymentModeOptions(user.organizationId, 'receipts')}
          initialPayNow={params.pay === 'now'}
          canTakePayment={hasPermission(user, 'payment.create', {
            branchId: user.primaryBranchId ?? undefined,
          })}
          incomeAccounts={hasPermission(user, 'accounting.view') ? accounts.income : undefined}
          moneyAccounts={accounts.money}
          initialAdvances={initialAdvances}
        />
      </Panel>
    </Stack>
  );
}
