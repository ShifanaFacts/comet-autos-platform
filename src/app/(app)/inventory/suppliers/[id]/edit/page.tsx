import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/authorize';
import { NotFoundError } from '@/lib/errors';
import { getSupplierForEdit } from '@/lib/inventory/suppliers';
import { PageHeader, Panel, Stack } from '@/components/layout/primitives';
import { SupplierForm } from '@/components/inventory/supplier-form';
import { updateSupplierAction } from '../../../actions';

export default async function EditSupplierPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  let supplier;
  try {
    supplier = await getSupplierForEdit(user, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  return (
    <Stack gap="2xl" className="animate-in fade-in duration-300">
      <PageHeader
        eyebrow={
          <Link
            href={`/inventory/suppliers/${supplier.id}`}
            className="tracking-normal normal-case hover:text-foreground"
          >
            ← {supplier.name}
          </Link>
        }
        title="Edit supplier"
      />
      <Panel className="w-full max-w-2xl sm:p-8">
        <SupplierForm
          action={updateSupplierAction.bind(null, supplier.id)}
          initial={supplier}
          cancelHref={`/inventory/suppliers/${supplier.id}`}
        />
      </Panel>
    </Stack>
  );
}
