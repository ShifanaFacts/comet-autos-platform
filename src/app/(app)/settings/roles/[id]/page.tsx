import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Info, ShieldCheck, Users2 } from 'lucide-react';
import { requireUser, hasPermission } from '@/lib/auth/authorize';
import { NotFoundError } from '@/lib/errors';
import { getRoleDetail } from '@/lib/access/roles';
import { PageHeader, Panel, Section, Stack } from '@/components/layout/primitives';
import { AccessDenied } from '@/components/shared/access-denied';
import { StatusPill } from '@/components/shared/status-pill';
import { RolePermissionsForm } from '@/components/access/role-permissions-form';

export const dynamic = 'force-dynamic';

export default async function RoleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!hasPermission(user, 'user.view')) {
    return <AccessDenied what="this role" />;
  }
  const { id } = await params;

  let role;
  try {
    role = await getRoleDetail(user, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const canManage = hasPermission(user, 'role.manage') && !role.isSystem;

  return (
    <Stack gap="2xl" className="animate-in fade-in duration-300">
      <Link
        href="/settings/roles"
        className="-ml-2 inline-flex h-11 w-fit items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Roles & permissions
      </Link>

      <PageHeader
        eyebrow="Role"
        title={role.name}
        description={
          role.description ??
          'What anyone holding this role is allowed to do, across the whole system.'
        }
        leading={role.isSystem ? <ShieldCheck className="size-6 text-primary" /> : undefined}
      />

      {role.isSystem ? (
        <p className="flex items-start gap-2 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" />
          This is a built-in role and its permissions can’t be changed. Create a role of your own to
          grant something different.
        </p>
      ) : null}

      <RolePermissionsForm
        roleId={role.id}
        modules={role.modules}
        canManage={canManage}
        granted={role.granted}
      />

      <Section
        title="Who holds this role"
        description={
          role.members.length === 0
            ? 'Nobody yet.'
            : `${role.members.length} ${role.members.length === 1 ? 'person' : 'people'}.`
        }
      >
        <Panel padding="none" className="overflow-hidden">
          {role.members.length === 0 ? (
            <p className="flex items-center gap-2 px-4 py-5 text-sm text-muted-foreground sm:px-6">
              <Users2 className="size-4" />
              Assign it to someone from their user page.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {role.members.map((member) => (
                <li key={member.id}>
                  <Link
                    href={`/settings/users/${member.id}`}
                    className="flex items-center justify-between gap-3 px-4 py-4 transition-colors hover:bg-muted/50 active:bg-muted sm:px-6"
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-medium">{member.fullName}</span>
                      <span className="truncate text-xs text-muted-foreground">{member.email}</span>
                    </span>
                    {!member.isActive ? <StatusPill tone="neutral">Inactive</StatusPill> : null}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </Section>
    </Stack>
  );
}
