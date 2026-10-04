import Link from 'next/link';
import { ArrowRight, BriefcaseBusiness, Info } from 'lucide-react';
import { hasPermission, requireUser } from '@/lib/auth/authorize';
import { DESIGNATION_PRESETS, listDesignations } from '@/lib/hr/designations';
import { PageHeader, Panel, Section, Stack } from '@/components/layout/primitives';
import { AccessDenied } from '@/components/shared/access-denied';
import { EmptyState } from '@/components/shared/empty-state';
import { InlineForm } from '@/components/shared/inline-form';
import { StatusPill } from '@/components/shared/status-pill';
import { NewDesignationForm } from '@/components/hr/designation-forms';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export default async function DesignationsPage() {
  const user = await requireUser();
  if (!hasPermission(user, 'employee.view')) return <AccessDenied what="designations" />;
  const designations = await listDesignations(user);
  const canEdit = hasPermission(user, 'employee.edit');

  return (
    <Stack gap="2xl" className="animate-in fade-in duration-300">
      <PageHeader
        eyebrow={
          <Link href="/hr/employees" className="hover:text-foreground">
            Team
          </Link>
        }
        title="Designations"
        description="The positions in the workshop — Technician, Supervisor, Manager. Each one decides which parts of the app its people can use."
      />

      {canEdit ? (
        <Panel padding="none" className="overflow-hidden">
          <InlineForm
            label="Add a designation"
            hint="Then tick what it may do."
            icon={<BriefcaseBusiness className="size-4" />}
            defaultOpen={designations.length === 0}
          >
            <NewDesignationForm presets={DESIGNATION_PRESETS} />
          </InlineForm>
        </Panel>
      ) : null}

      <Section title="Designations">
        {designations.length === 0 ? (
          <EmptyState
            icon={BriefcaseBusiness}
            title="No designations yet"
            description="Add Technician, Supervisor, Manager and the like, then give each one its permissions."
          />
        ) : (
          <Panel padding="none" className="overflow-hidden">
            <ul className="divide-y divide-border">
              {designations.map((designation) => (
                <li key={designation.id}>
                  <Link
                    href={`/hr/designations/${designation.id}`}
                    className={cn(
                      'flex items-center gap-4 px-4 py-4 transition-colors hover:bg-muted/50 active:bg-muted sm:px-6',
                      !designation.isActive && 'text-muted-foreground',
                    )}
                  >
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="flex flex-wrap items-center gap-2 font-medium">
                        {designation.name}
                        {designation.isActive ? null : (
                          <StatusPill tone="neutral">Inactive</StatusPill>
                        )}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {designation.employeeCount}{' '}
                        {designation.employeeCount === 1 ? 'person' : 'people'} ·{' '}
                        {designation.role
                          ? `${designation.permissionCount} permission${designation.permissionCount === 1 ? '' : 's'}`
                          : 'No permissions set'}
                      </span>
                    </span>
                    <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
        )}
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          An employee&apos;s login can do what their designation allows. Change the permissions
          here and everyone holding the designation follows.
        </p>
      </Section>
    </Stack>
  );
}
