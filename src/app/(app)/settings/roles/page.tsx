import Link from 'next/link';
import { ChevronRight, KeyRound, ShieldCheck } from 'lucide-react';
import { requireUser, hasPermission } from '@/lib/auth/authorize';
import { listRoles } from '@/lib/access/roles';
import { PERMISSION_CODES } from '@/lib/auth/permission-catalog';
import { PageHeader, Panel, Stack } from '@/components/layout/primitives';
import { AccessDenied } from '@/components/shared/access-denied';
import { EmptyState } from '@/components/shared/empty-state';
import { AccessTabs } from '@/components/access/access-tabs';
import { NewRoleForm } from '@/components/access/new-role-form';

export const dynamic = 'force-dynamic';

export default async function RolesPage() {
  const user = await requireUser();
  if (!hasPermission(user, 'user.view')) {
    return <AccessDenied what="the workshop's roles" />;
  }
  const roles = await listRoles(user);
  const canManage = hasPermission(user, 'role.manage');

  return (
    <Stack gap="2xl" className="animate-in fade-in duration-300">
      <PageHeader
        eyebrow="Settings"
        title="Users & roles"
        description="A role is a named bundle of permissions. People hold roles; what they can do is the sum of them."
      />

      <AccessTabs active="roles" />

      {roles.length === 0 ? (
        <EmptyState
          icon={KeyRound}
          title="No roles yet"
          description="Create a role for each kind of job in the workshop — a technician, a receptionist, a manager — then give people the one that fits."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {roles.map((role) => (
            <li key={role.id}>
              <Link
                href={`/settings/roles/${role.id}`}
                className="flex items-center gap-4 rounded-xl border border-border bg-card px-4 py-4 transition-colors hover:bg-muted/50 active:bg-muted sm:px-6"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="flex items-center gap-1.5 font-medium">
                      {role.isSystem ? <ShieldCheck className="size-4 text-primary" /> : null}
                      {role.name}
                    </span>
                    {role.isSystem ? (
                      <span className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        Built in
                      </span>
                    ) : null}
                  </span>
                  {role.description ? (
                    <span className="text-sm text-muted-foreground">{role.description}</span>
                  ) : null}
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {role.permissionCount === PERMISSION_CODES.length
                      ? 'Every permission'
                      : `${role.permissionCount} of ${PERMISSION_CODES.length} permissions`}
                    {' · '}
                    {role.userCount} active {role.userCount === 1 ? 'person' : 'people'}
                  </span>
                </span>
                <ChevronRight className="size-5 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {canManage ? (
        <Panel className="max-w-2xl">
          <NewRoleForm />
        </Panel>
      ) : null}
    </Stack>
  );
}
