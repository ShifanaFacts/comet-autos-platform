import { requireUser } from '@/lib/auth/authorize';
import { listOpenJobCardsForTasks } from '@/lib/team/tasks';
import { localDateString } from '@/lib/format';
import { PageHeader, Panel, Stack } from '@/components/layout/primitives';
import { TaskComposer } from '@/components/team/task-composer';

export const dynamic = 'force-dynamic';

export default async function NewTodoPage() {
  const user = await requireUser();
  const jobCards = await listOpenJobCardsForTasks(user);
  return (
    <Stack gap="xl" className="animate-in fade-in duration-300">
      <PageHeader eyebrow="My work" title="Add a to-do" description="Say it or type it. It goes on your own list." />
      <Panel className="max-w-2xl">
        <TaskComposer mode="own" today={localDateString()} jobCards={jobCards} backHref="/my-work" />
      </Panel>
    </Stack>
  );
}
