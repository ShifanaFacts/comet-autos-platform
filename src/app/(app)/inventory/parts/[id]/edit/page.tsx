import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/authorize';
import { prisma } from '@/lib/prisma';
import { NotFoundError } from '@/lib/errors';
import { getPartForEdit, listCategories } from '@/lib/inventory/parts';
import { resolveDefaultVatRate } from '@/lib/tax';
import { PageHeader, Panel, Stack } from '@/components/layout/primitives';
import { PartForm } from '@/components/inventory/part-form';
import { updatePartAction } from '../../../actions';

export default async function EditPartPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  let part;
  try {
    part = await getPartForEdit(user, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const [categories, suppliers] = await Promise.all([
    listCategories(user.organizationId),
    prisma.supplier.findMany({
      where: {
        organizationId: user.organizationId,
        OR: [{ isActive: true }, { id: part.preferredSupplierId ?? undefined }],
      },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
  ]);

  return (
    <Stack gap="2xl" className="animate-in fade-in duration-300">
      <PageHeader
        eyebrow={
          <Link
            href={`/inventory/parts/${part.id}`}
            className="tracking-normal normal-case hover:text-foreground"
          >
            ← {part.name}
          </Link>
        }
        title="Edit part"
        description={<span className="font-mono">{part.sku}</span>}
      />
      <Panel className="w-full max-w-3xl sm:p-8">
        <PartForm
          action={updatePartAction.bind(null, part.id)}
          initial={{
            sku: part.sku,
            name: part.name,
            category: part.category ?? '',
            description: part.description ?? '',
            preferredSupplierId: part.preferredSupplierId ?? '',
            unitOfMeasure: part.unitOfMeasure,
            costPrice: part.defaultCostPrice?.toFixed(2) ?? '',
            sellingPrice: part.defaultSellingPrice?.toFixed(2) ?? '',
            taxRate: part.defaultTaxRate?.toString() ?? '',
            reorderLevel: part.reorderLevel?.toString() ?? '',
            isActive: part.isActive,
          }}
          categories={categories}
          suppliers={suppliers}
          defaultVat={await resolveDefaultVatRate(user.organizationId)}
          isNew={false}
          cancelHref={`/inventory/parts/${part.id}`}
        />
      </Panel>
    </Stack>
  );
}
