import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowRight, Info, Pencil, Users2 } from 'lucide-react';
import { hasPermission, requireUser } from '@/lib/auth/authorize';
import { NotFoundError } from '@/lib/errors';
import { getDesignationDetail } from '@/lib/hr/designations';
import { PageHeader, Panel, Section, Stack } from '@/components/layout/primitives';
import { AccessDenied } from '@/components/shared/access-denied';
import { InlineForm } from '@/components/shared/inline-form';
import { StatusPill } from '@/components/shared/status-pill';
import { RolePermissionsForm } from '@/components/access/role-permissions-form';
import { EditDesignationForm } from '@/components/hr/designation-forms';

export const dynamic = 'force-dynamic';

export default async function DesignationPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!hasPermission(user, 'employee.view')) return <AccessDenied what="designations" />;
  const { id } = await params;

  let designation;
  try {
    designation = await getDesignationDetail(user, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const canEdit = hasPermission(user, 'employee.edit');
  const role = designation.role;
  const canManagePermissions = !!role && hasPermission(user, 'role.edit') && !role.isSystem;

  return (
    <Stack gap="2xl" className="animate-in fade-in duration-300">
      <PageHeader
        eyebrow={
          <Link href="/hr/designations" className="hover:text-foreground">
            Designations
          </Link>
        }
        title={
          <>
            {designation.name}
            {designation.isActive ? null : <StatusPill tone="neutral">Inactive</StatusPill>}
          </>
        }
        description={
          designation.description ??
          'What anyone with this designation can do in the app, through their login.'
        }
      />

      {canEdit ? (
        <Panel padding="none" className="overflow-hidden">
          <InlineForm label="Edit designation" icon={<Pencil className="size-4" />}>
            <EditDesignationForm designation={designation} />
          </InlineForm>
        </Panel>
      ) : null}

      {role ? (
        <>
          {role.isSystem ? (
            <p className="flex items-start gap-2 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
              <Info className="mt-0.5 size-4 shrink-0" />
              This designation uses the built-in {role.name} role, which always holds every
              permission and can&apos;t be changed.
            </p>
          ) : role.name !== designation.name ? (
            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              Its permissions are the {role.name} role&apos;s — anyone given that role in Users &amp;
              roles has them too.
            </p>
          ) : null}
          <RolePermissionsForm
            roleId={role.id}
            modules={role.modules}
            granted={role.granted}
            canManage={canManagePermissions}
          />
        </>
      ) : (
        <Panel>
          <p className="text-sm text-muted-foreground">
            {designation.roleId
              ? 'You don’t have permission to see roles, so its permissions aren’t shown.'
              : 'No permissions are set for this designation yet.'}
          </p>
        </Panel>
      )}

      <Section
        title="Who holds it"
        description={
          designation.employees.length === 0
            ? 'Nobody yet.'
            : `${designation.employees.length} ${designation.employees.length === 1 ? 'person' : 'people'}.`
        }
      >
        <Panel padding="none" className="overflow-hidden">
          {designation.employees.length === 0 ? (
            <p className="flex items-center gap-2 px-4 py-5 text-sm text-muted-foreground sm:px-6">
              <Users2 className="size-4" />
              Choose it on an employee&apos;s record.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {designation.employees.map((employee) => (
                <li key={employee.id}>
                  <Link
                    href={`/hr/employees/${employee.id}`}
                    className="flex items-center gap-3 px-4 py-4 transition-colors hover:bg-muted/50 active:bg-muted sm:px-6"
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-medium">{employee.name}</span>
                      <span className="truncate font-mono text-xs text-muted-foreground">
                        {employee.employeeCode}
                        {employee.user ? '' : ' · no login'}
                      </span>
                    </span>
                    {!employee.isActive ? <StatusPill tone="neutral">Left</StatusPill> : null}
                    <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
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
