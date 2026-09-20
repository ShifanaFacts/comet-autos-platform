import { hasPermission, requireUser } from '@/lib/auth/authorize';
import { getEmployeeFormOptions } from '@/lib/hr/employees';
import { PageHeader, Panel, Stack } from '@/components/layout/primitives';
import { AccessDenied } from '@/components/shared/access-denied';
import { EmployeeForm } from '@/components/hr/employee-form';
import { createEmployeeAction } from '../../actions';

export default async function NewEmployeePage() {
  const user = await requireUser();
  if (!hasPermission(user, 'payroll.create')) return <AccessDenied what="adding employees" />;
  const options = await getEmployeeFormOptions(user);

  return (
    <Stack gap="2xl" className="animate-in fade-in duration-300">
      <PageHeader
        eyebrow="Team"
        title="Add employee"
        description="Who they are and where they work. A system login is optional."
      />
      <Panel className="max-w-3xl">
        <EmployeeForm action={createEmployeeAction} options={options} cancelHref="/hr/employees" />
      </Panel>
    </Stack>
  );
}
