import { notFound } from 'next/navigation';
import { requireUser, hasPermission } from '@/lib/auth/authorize';
import { NotFoundError } from '@/lib/errors';
import { getAccessOptions, getUserDetail } from '@/lib/access/users';
import { PageHeader, Panel, Stack } from '@/components/layout/primitives';
import { AccessDenied } from '@/components/shared/access-denied';
import { UserForm } from '@/components/access/user-form';

export const dynamic = 'force-dynamic';

export default async function EditUserPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!hasPermission(user, 'user.manage')) {
    return <AccessDenied what="changing a user" />;
  }
  const { id } = await params;

  let detail;
  let options;
  try {
    // Independent reads, together: the account and the pickers.
    [detail, options] = await Promise.all([getUserDetail(user, id), getAccessOptions(user, id)]);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  return (
    <Stack gap="2xl" className="animate-in fade-in duration-300">
      <PageHeader
        eyebrow="Users & roles"
        title={`Edit ${detail.fullName}`}
        description="Their details, which branch they belong to, and what they are allowed to do."
      />
      <Panel className="max-w-3xl sm:p-8">
        <UserForm
          mode="edit"
          options={options}
          isSelf={detail.id === user.id}
          initial={{
            id: detail.id,
            fullName: detail.fullName,
            email: detail.email,
            phone: detail.phone ?? '',
            primaryBranchId: detail.primaryBranch?.id ?? '',
            roleIds: detail.roles.map((role) => role.id),
            employeeId: detail.employee?.id ?? '',
          }}
        />
      </Panel>
    </Stack>
  );
}
