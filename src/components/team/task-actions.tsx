'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarClock, Check, Loader2, Pencil, Play, RotateCcw, Star, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { TaskPriority, TaskStatus } from '@/generated/prisma/enums';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { CONTROL } from '@/components/forms/control';
import { FormError, NativeSelect, TextareaField, TextField } from '@/components/forms/fields';
import { MoveDialog } from '@/components/team/todo-list';
import { SpeechField, emptySpeech, type SpeechFieldValue } from '@/components/team/speech-field';
import { PhotoPicker } from '@/components/team/photo-picker';
import { TASK_PRIORITIES } from '@/lib/team/labels';
import type { TaskAbilities } from '@/lib/team/task-rules';
import { newRequestKey, postMultipart } from '@/lib/team/client';
import {
  editTaskAction,
  setTaskHighlightAction,
  setTaskStatusAction,
} from '@/app/(app)/team/actions';
import { cn } from '@/lib/utils';

export interface TaskForActions {
  id: string;
  title: string;
  details: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueKey: string | null;
  isAssigned: boolean;
  highlighted: boolean;
  jobCardId: string | null;
  assigneeId: string;
  mine: boolean;
}

/** The buttons on a task: start, done, reopen, star, move, edit, delete. */
export function TaskActions({
  task,
  can,
  today,
  employees,
  jobCards,
}: {
  task: TaskForActions;
  can: TaskAbilities;
  today: string;
  employees: { id: string; name: string }[];
  jobCards: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [moving, setMoving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  function status(next: TaskStatus, done: string) {
    startTransition(async () => {
      const result = await setTaskStatusAction(task.id, next);
      if (!result.ok) {
        toast.error(result.error ?? 'That could not be saved.');
        return;
      }
      toast.success(done);
      router.refresh();
    });
  }

  function star() {
    startTransition(async () => {
      const result = await setTaskHighlightAction(task.id, !task.highlighted);
      if (!result.ok) toast.error(result.error ?? 'That could not be saved.');
      router.refresh();
    });
  }

  const open = task.status === 'TODO' || task.status === 'IN_PROGRESS';

  return (
    <div className="flex flex-wrap gap-2">
      {can.progress && task.status === 'TODO' ? (
        <Button variant="outline" className="h-11" disabled={pending} onClick={() => status('IN_PROGRESS', 'Started')}>
          <Play />
          Start
        </Button>
      ) : null}
      {can.progress && open ? (
        <Button className="h-11" disabled={pending} onClick={() => status('DONE', 'Done — well done')}>
          {pending ? <Loader2 className="animate-spin" /> : <Check />}
          Mark done
        </Button>
      ) : null}
      {can.progress && !open ? (
        <Button variant="outline" className="h-11" disabled={pending} onClick={() => status('TODO', 'Reopened')}>
          <RotateCcw />
          Reopen
        </Button>
      ) : null}
      {can.highlight ? (
        <Button
          variant="outline"
          className={cn('h-11', task.highlighted && 'border-warning text-warning')}
          disabled={pending}
          onClick={star}
        >
          <Star className={cn(task.highlighted && 'fill-current')} />
          {task.highlighted ? 'Starred' : 'Star'}
        </Button>
      ) : null}
      {can.move ? (
        <Button variant="outline" className="h-11" onClick={() => setMoving(true)}>
          <CalendarClock />
          Move day
        </Button>
      ) : null}
      {can.edit ? (
        <Button variant="outline" className="h-11" onClick={() => setEditing(true)}>
          <Pencil />
          Edit
        </Button>
      ) : null}
      {can.cancel ? (
        <Button variant="destructive" className="h-11" onClick={() => setConfirmCancel(true)}>
          <Trash2 />
          {task.isAssigned ? 'Cancel task' : 'Delete'}
        </Button>
      ) : null}

      {moving ? <MoveDialog task={task} today={today} onClose={() => setMoving(false)} /> : null}
      {editing ? (
        <EditDialog
          task={task}
          can={can}
          today={today}
          employees={employees}
          jobCards={jobCards}
          onClose={() => setEditing(false)}
        />
      ) : null}
      <Dialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{task.isAssigned ? 'Cancel this task?' : 'Delete this to-do?'}</DialogTitle>
            <DialogDescription>
              It leaves the list. It stays in the history, and can be reopened.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <Button
              variant="destructive"
              className="h-12 sm:h-11"
              disabled={pending}
              onClick={() => {
                setConfirmCancel(false);
                status('CANCELLED', task.isAssigned ? 'Task cancelled' : 'Deleted');
              }}
            >
              {task.isAssigned ? 'Cancel task' : 'Delete'}
            </Button>
            <Button variant="ghost" className="h-12 sm:h-11" onClick={() => setConfirmCancel(false)}>
              Keep it
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EditDialog({
  task,
  can,
  today,
  employees,
  jobCards,
  onClose,
}: {
  task: TaskForActions;
  can: TaskAbilities;
  today: string;
  employees: { id: string; name: string }[];
  jobCards: { id: string; label: string }[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [priority, setPriority] = useState<TaskPriority>(task.priority);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const [requestKey] = useState(newRequestKey);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    form.set('priority', priority);
    form.set('requestKey', requestKey);
    if (!can.dueDate) form.set('dueDate', task.dueKey ?? '');
    startTransition(async () => {
      const result = await editTaskAction(task.id, { ok: false }, form);
      if (!result.ok) {
        setError(result.error ?? 'It could not be saved.');
        setFieldErrors(result.fieldErrors ?? {});
        return;
      }
      toast.success('Saved');
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit task</DialogTitle>
          <DialogDescription>Every change is kept in the task’s history.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-5">
          <TextField id="edit-title" name="title" label="Task" defaultValue={task.title} error={fieldErrors.title} required />
          <TextareaField id="edit-details" name="details" label="Details" defaultValue={task.details ?? ''} rows={3} />
          {can.dueDate ? (
            <div className="flex flex-col gap-2">
              <label htmlFor="edit-due" className="text-sm font-medium">Day</label>
              <input
                id="edit-due"
                type="date"
                name="dueDate"
                min={today}
                defaultValue={task.dueKey ?? today}
                className={cn(CONTROL, 'h-11 w-44')}
              />
              {fieldErrors.dueDate ? <p className="text-xs text-destructive">{fieldErrors.dueDate}</p> : null}
            </div>
          ) : null}
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Priority</span>
            <div className="grid grid-cols-4 gap-2">
              {TASK_PRIORITIES.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={priority === option.value}
                  onClick={() => setPriority(option.value)}
                  className={cn(
                    'h-11 rounded-lg border text-sm font-medium',
                    priority === option.value ? 'border-primary bg-primary/5 text-primary' : 'border-border bg-card',
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          {can.reassign && employees.length ? (
            <div className="flex flex-col gap-2">
              <label htmlFor="edit-assignee" className="text-sm font-medium">For</label>
              <NativeSelect id="edit-assignee" name="assigneeId" defaultValue={task.assigneeId}>
                {employees.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
          ) : null}
          {jobCards.length ? (
            <div className="flex flex-col gap-2">
              <label htmlFor="edit-job" className="text-sm font-medium">Job card</label>
              <NativeSelect id="edit-job" name="jobCardId" defaultValue={task.jobCardId ?? ''}>
                <option value="">Not about one job</option>
                {jobCards.map((job) => (
                  <option key={job.id} value={job.id}>
                    {job.label}
                  </option>
                ))}
              </NativeSelect>
            </div>
          ) : (
            <input type="hidden" name="jobCardId" value={task.jobCardId ?? ''} />
          )}
          <FormError message={Object.keys(fieldErrors).length ? undefined : (error ?? undefined)} />
          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <Button type="submit" disabled={pending} className="h-12 sm:h-11">
              {pending ? 'Saving…' : 'Save changes'}
            </Button>
            <Button type="button" variant="ghost" className="h-12 sm:h-11" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Adding a note, photos or a voice note to a task. */
export function NoteComposer({ taskId }: { taskId: string }) {
  const router = useRouter();
  const [speech, setSpeech] = useState<SpeechFieldValue>(emptySpeech());
  const [photos, setPhotos] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestKey, setRequestKey] = useState(newRequestKey);
  const [round, setRound] = useState(0);

  async function save() {
    setError(null);
    if (!speech.text.trim() && photos.length === 0 && !speech.voice) {
      setError('Say or type a note, or add a photo.');
      return;
    }
    const form = new FormData();
    form.set('body', speech.text.trim());
    form.set('language', speech.language);
    form.set('requestKey', requestKey);
    for (const photo of photos) form.append('photos', photo);
    if (speech.voice) form.set('voice', speech.voice, 'voice-note');
    setSaving(true);
    const result = await postMultipart(`/team/tasks/${taskId}/notes`, form);
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? 'It could not be saved.');
      return;
    }
    toast.success('Note added');
    setSpeech(emptySpeech(speech.language));
    setPhotos([]);
    setRequestKey(newRequestKey());
    setRound((n) => n + 1);
    router.refresh();
  }

  return (
    <div key={round} className="flex flex-col gap-4">
      <SpeechField id={`note-${taskId}`} label="Add a note" rows={2} value={speech} onChange={setSpeech} placeholder="An update, a problem, what you found…" />
      <PhotoPicker files={photos} onChange={setPhotos} />
      <FormError message={error ?? undefined} />
      <Button type="button" onClick={save} disabled={saving} className="h-11 w-fit">
        {saving ? <Loader2 className="animate-spin" /> : null}
        {saving ? 'Saving…' : speech.heard ? 'The text is right — add note' : 'Add note'}
      </Button>
    </div>
  );
}
