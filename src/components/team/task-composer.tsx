'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Loader2, Users } from 'lucide-react';
import { toast } from 'sonner';
import type { TaskPriority } from '@/generated/prisma/enums';
import { Button } from '@/components/ui/button';
import { FormError, NativeSelect } from '@/components/forms/fields';
import { CONTROL } from '@/components/forms/control';
import { SpeechField, emptySpeech, type SpeechFieldValue } from '@/components/team/speech-field';
import { PhotoPicker } from '@/components/team/photo-picker';
import { TASK_PRIORITIES } from '@/lib/team/labels';
import { addDays, newRequestKey, postMultipart, splitTaskText } from '@/lib/team/client';
import { cn } from '@/lib/utils';

/*
 * Writing a task down — for someone else ("assign") or for yourself
 * ("own"). Say it or type it; the first line is the task, anything after it
 * is the detail. Pick the day (today by default), how urgent it is, and
 * optionally the job card it is about and a few photos.
 */

export interface Assignable {
  id: string;
  name: string;
  jobTitle: string | null;
  hasLogin: boolean;
}

export function TaskComposer({
  mode,
  today,
  employees = [],
  jobCards = [],
  preselected = [],
  backHref,
}: {
  mode: 'assign' | 'own';
  today: string;
  employees?: Assignable[];
  jobCards?: { id: string; label: string }[];
  preselected?: string[];
  backHref: string;
}) {
  const router = useRouter();
  const [speech, setSpeech] = useState<SpeechFieldValue>(emptySpeech());
  const [assignees, setAssignees] = useState<string[]>(preselected);
  const [dueDate, setDueDate] = useState(today);
  const [priority, setPriority] = useState<TaskPriority>('NORMAL');
  const [jobCardId, setJobCardId] = useState('');
  const [photos, setPhotos] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [requestKey] = useState(newRequestKey);

  const tomorrow = addDays(today, 1);
  const quickDays = [
    { value: today, label: 'Today' },
    { value: tomorrow, label: 'Tomorrow' },
  ];

  function toggle(id: string) {
    setAssignees((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));
  }

  async function save() {
    setError(null);
    setFieldErrors({});
    const { title, details } = splitTaskText(speech.text);
    if (title.length < 2) {
      setFieldErrors({ title: 'Say or type what needs doing.' });
      return;
    }
    if (mode === 'assign' && assignees.length === 0) {
      setFieldErrors({ assigneeIds: 'Choose who it is for.' });
      return;
    }
    const form = new FormData();
    form.set('title', title);
    form.set('details', details);
    form.set('language', speech.language);
    for (const id of assignees) form.append('assigneeIds', id);
    form.set('dueDate', dueDate);
    form.set('priority', priority);
    form.set('jobCardId', jobCardId);
    form.set('requestKey', requestKey);
    for (const photo of photos) form.append('photos', photo);
    if (speech.voice) form.set('voice', speech.voice, 'voice-note');

    setSaving(true);
    setPercent(0);
    const result = await postMultipart('/team/tasks', form, setPercent);
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? 'It could not be saved.');
      setFieldErrors(result.fieldErrors ?? {});
      return;
    }
    toast.success(
      mode === 'own'
        ? 'Added to your list'
        : assignees.length === 1
          ? `Sent to ${employees.find((e) => e.id === assignees[0])?.name ?? 'them'}`
          : `Sent to ${assignees.length} people`,
    );
    router.push(backHref);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6 @container">
      <SpeechField
        id="task-text"
        label={mode === 'own' ? 'What do you need to do?' : 'What needs doing?'}
        placeholder="Tap the mic and speak, or type. The first line is the task; add details on the lines after."
        rows={4}
        value={speech}
        onChange={setSpeech}
        error={fieldErrors.title ?? fieldErrors.details}
        autoFocus
      />

      {mode === 'assign' ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 flex w-full flex-wrap items-center justify-between gap-2 text-sm font-medium">
            <span className="flex items-center gap-2">
              <Users className="size-4 text-muted-foreground" />
              For
            </span>
            {employees.length > 1 ? (
              <button
                type="button"
                className="text-xs font-normal text-primary hover:underline"
                onClick={() =>
                  setAssignees(assignees.length === employees.length ? [] : employees.map((e) => e.id))
                }
              >
                {assignees.length === employees.length ? 'Clear' : 'Everyone'}
              </button>
            ) : null}
          </legend>
          <div className="grid grid-cols-1 gap-2 @md:grid-cols-2">
            {employees.map((employee) => {
              const chosen = assignees.includes(employee.id);
              return (
                <button
                  key={employee.id}
                  type="button"
                  onClick={() => toggle(employee.id)}
                  aria-pressed={chosen}
                  className={cn(
                    'flex min-h-14 items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors',
                    chosen ? 'border-primary bg-primary/5' : 'border-border bg-card hover:bg-muted/50',
                  )}
                >
                  <span
                    className={cn(
                      'flex size-6 shrink-0 items-center justify-center rounded-md border',
                      chosen ? 'border-primary bg-primary text-primary-foreground' : 'border-input',
                    )}
                  >
                    {chosen ? <Check className="size-4" /> : null}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium">{employee.name}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {employee.jobTitle ?? 'Team'}
                      {employee.hasLogin ? '' : ' · no login yet — sees it once one is made'}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          {fieldErrors.assigneeIds ? (
            <p className="text-xs text-destructive">{fieldErrors.assigneeIds}</p>
          ) : null}
        </fieldset>
      ) : null}

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">When</span>
        <div className="flex flex-wrap items-center gap-2">
          {quickDays.map((day) => (
            <button
              key={day.value}
              type="button"
              onClick={() => setDueDate(day.value)}
              aria-pressed={dueDate === day.value}
              className={cn(
                'h-11 rounded-lg border px-4 text-sm font-medium',
                dueDate === day.value ? 'border-primary bg-primary/5 text-primary' : 'border-border bg-card hover:bg-muted',
              )}
            >
              {day.label}
            </button>
          ))}
          <input
            type="date"
            value={dueDate}
            min={today}
            onChange={(event) => setDueDate(event.target.value || today)}
            aria-label="Pick a day"
            className={cn(CONTROL, 'h-11 w-44')}
          />
        </div>
        {fieldErrors.dueDate ? <p className="text-xs text-destructive">{fieldErrors.dueDate}</p> : null}
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Priority</span>
        <div className="grid grid-cols-4 gap-2 sm:w-fit">
          {TASK_PRIORITIES.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setPriority(option.value)}
              aria-pressed={priority === option.value}
              className={cn(
                'h-11 rounded-lg border px-3 text-sm font-medium sm:min-w-20',
                priority === option.value
                  ? option.value === 'URGENT'
                    ? 'border-danger bg-danger/10 text-danger'
                    : option.value === 'HIGH'
                      ? 'border-warning bg-warning/10 text-warning'
                      : 'border-primary bg-primary/5 text-primary'
                  : 'border-border bg-card hover:bg-muted',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {jobCards.length ? (
        <div className="flex flex-col gap-2">
          <label htmlFor="task-job" className="text-sm font-medium">
            About a job card <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <NativeSelect id="task-job" value={jobCardId} onChange={(event) => setJobCardId(event.target.value)}>
            <option value="">Not about one job</option>
            {jobCards.map((job) => (
              <option key={job.id} value={job.id}>
                {job.label}
              </option>
            ))}
          </NativeSelect>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">
          Photos <span className="font-normal text-muted-foreground">(optional)</span>
        </span>
        <PhotoPicker files={photos} onChange={setPhotos} />
        {fieldErrors.photos ? <p className="text-xs text-destructive">{fieldErrors.photos}</p> : null}
        {fieldErrors.voice ? <p className="text-xs text-destructive">{fieldErrors.voice}</p> : null}
      </div>

      <FormError message={error ?? undefined} />

      <div className="flex flex-col gap-2 sm:flex-row-reverse sm:justify-start">
        <Button type="button" onClick={save} disabled={saving} className="h-12 px-6 text-base sm:h-11 sm:text-sm">
          {saving ? (
            <>
              <Loader2 className="animate-spin" />
              {percent > 0 && percent < 100 ? `Sending ${percent}%` : 'Saving…'}
            </>
          ) : speech.heard ? (
            'The text is right — save'
          ) : mode === 'own' ? (
            'Add to my list'
          ) : (
            'Send task'
          )}
        </Button>
        <Button type="button" variant="ghost" className="h-12 sm:h-11" onClick={() => router.push(backHref)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
