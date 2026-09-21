import { requireUser, hasPermission } from '@/lib/auth/authorize';
import { getAccessOptions } from '@/lib/access/users';
import { PageHeader, Panel, Stack } from '@/components/layout/primitives';
import { AccessDenied } from '@/components/shared/access-denied';
import { UserForm } from '@/components/access/user-form';

export const dynamic = 'force-dynamic';

export default async function NewUserPage() {
  const user = await requireUser();
  if (!hasPermission(user, 'user.manage')) {
    return <AccessDenied what="adding a user" />;
  }
  const options = await getAccessOptions(user);

  return (
    <Stack gap="2xl" className="animate-in fade-in duration-300">
      <PageHeader
        eyebrow="Users & roles"
        title="Add a user"
        description="Give someone a way to sign in, and decide what they can do."
      />
      <Panel className="max-w-3xl sm:p-8">
        <UserForm
          mode="create"
          options={options}
          initial={{
            fullName: '',
            email: '',
            phone: '',
            primaryBranchId: user.primaryBranchId ?? '',
            roleIds: [],
            employeeId: '',
          }}
        />
      </Panel>
    </Stack>
  );
}
