import Link from 'next/link';
import { requireUser, hasPermission } from '@/lib/auth/authorize';
import { AccessDenied } from '@/components/shared/access-denied';
import { PageHeader, Panel, Stack } from '@/components/layout/primitives';
import { SupplierForm } from '@/components/inventory/supplier-form';
import { createSupplierAction } from '../../actions';

export default async function NewSupplierPage() {
  const user = await requireUser();
  if (
    !hasPermission(
      user,
      'inventory.manage',
      user.primaryBranchId ? { branchId: user.primaryBranchId } : undefined,
    )
  ) {
    return <AccessDenied what="adding suppliers" />;
  }
  return (
    <Stack gap="2xl" className="animate-in fade-in duration-300">
      <PageHeader
        eyebrow={
          <Link
            href="/inventory/suppliers"
            className="tracking-normal normal-case hover:text-foreground"
          >
            ← Suppliers
          </Link>
        }
        title="New supplier"
      />
      <Panel className="w-full max-w-2xl sm:p-8">
        <SupplierForm action={createSupplierAction} cancelHref="/inventory/suppliers" />
      </Panel>
    </Stack>
  );
}
