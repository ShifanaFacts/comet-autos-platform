import Link from 'next/link';
import { requireUser, hasPermission } from '@/lib/auth/authorize';
import { AccessDenied } from '@/components/shared/access-denied';
import { prisma } from '@/lib/prisma';
import { listCategories } from '@/lib/inventory/parts';
import { resolveDefaultVatRate } from '@/lib/tax';
import { PageHeader, Panel, Stack } from '@/components/layout/primitives';
import { PartForm } from '@/components/inventory/part-form';
import { createPartAction } from '../../actions';

export default async function NewPartPage() {
  const user = await requireUser();
  if (
    !hasPermission(
      user,
      'inventory.manage',
      user.primaryBranchId ? { branchId: user.primaryBranchId } : undefined,
    )
  ) {
    return <AccessDenied what="adding parts" />;
  }
  const [categories, suppliers] = await Promise.all([
    listCategories(user.organizationId),
    prisma.supplier.findMany({
      where: { organizationId: user.organizationId, isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
  ]);

  return (
    <Stack gap="2xl" className="animate-in fade-in duration-300">
      <PageHeader
        eyebrow={
          <Link
            href="/inventory/parts"
            className="tracking-normal normal-case hover:text-foreground"
          >
            ← Parts
          </Link>
        }
        title="New part"
        description="Add a part to the catalogue. Opening stock is recorded in the stock history."
      />
      <Panel className="w-full max-w-3xl sm:p-8">
        <PartForm
          action={createPartAction}
          categories={categories}
          suppliers={suppliers}
          defaultVat={await resolveDefaultVatRate(user.organizationId)}
          isNew
          cancelHref="/inventory/parts"
        />
      </Panel>
    </Stack>
  );
}
