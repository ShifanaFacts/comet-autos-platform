import { AuthError, requireUser } from '@/lib/auth/authorize';
import { listAssignableEmployees, listOpenJobCardsForTasks } from '@/lib/team/tasks';
import { localDateString } from '@/lib/format';
import { PageHeader, Panel, Stack } from '@/components/layout/primitives';
import { AccessDenied } from '@/components/shared/access-denied';
import { TaskComposer } from '@/components/team/task-composer';

export const dynamic = 'force-dynamic';

export default async function AssignTaskPage({
  searchParams,
}: {
  searchParams: Promise<{ for?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  let employees: Awaited<ReturnType<typeof listAssignableEmployees>>;
  try {
    employees = await listAssignableEmployees(user);
  } catch (error) {
    if (error instanceof AuthError) return <AccessDenied what="giving tasks to the team" />;
    throw error;
  }
  const jobCards = await listOpenJobCardsForTasks(user);
  const preselected = employees.some((employee) => employee.id === params.for) ? [params.for!] : [];

  return (
    <Stack gap="xl" className="animate-in fade-in duration-300">
      <PageHeader
        eyebrow="Team tasks"
        title="Give a task"
        description="Speak or type it, choose who it is for. It appears on their My work list straight away."
      />
      <Panel className="max-w-3xl">
        <TaskComposer
          mode="assign"
          today={localDateString()}
          employees={employees}
          jobCards={jobCards}
          preselected={preselected}
          backHref="/team"
        />
      </Panel>
    </Stack>
  );
}
