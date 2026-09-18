'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Loader2, Plus, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea, FormError } from '@/components/forms/fields';
import { ConfirmAction } from '@/components/shared/confirm-action';
import { saveInspectionAction } from '../actions';
import { cn } from '@/lib/utils';

type Result = 'OK' | 'ATTENTION_NEEDED' | 'FAILED' | 'NOT_CHECKED';

export interface ChecklistItem {
  key: string;
  category: string;
  description: string;
  result: Result;
  notes: string;
}

const CHOICES: { value: Result; label: string; active: string }[] = [
  { value: 'OK', label: 'Pass', active: 'border-success bg-success text-success-foreground' },
  { value: 'ATTENTION_NEEDED', label: 'Attention', active: 'border-warning bg-warning text-warning-foreground' },
  { value: 'FAILED', label: 'Fail', active: 'border-danger bg-danger text-danger-foreground' },
  { value: 'NOT_CHECKED', label: 'Not checked', active: 'border-foreground/30 bg-muted text-foreground' },
];

export function InspectionChecklist({
  jobCardId,
  inspectionId,
  initialItems,
  initialSummary,
}: {
  jobCardId: string;
  inspectionId: string;
  initialItems: ChecklistItem[];
  initialSummary: string;
}) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [summary, setSummary] = useState(initialSummary);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [pendingKind, setPendingKind] = useState<'save' | 'complete' | null>(null);
  const [newItem, setNewItem] = useState('');

  const categories = useMemo(() => [...new Set(items.map((item) => item.category))], [items]);
  const counts = useMemo(
    () => ({
      OK: items.filter((i) => i.result === 'OK').length,
      ATTENTION_NEEDED: items.filter((i) => i.result === 'ATTENTION_NEEDED').length,
      FAILED: items.filter((i) => i.result === 'FAILED').length,
      NOT_CHECKED: items.filter((i) => i.result === 'NOT_CHECKED').length,
    }),
    [items],
  );

  function update(key: string, patch: Partial<ChecklistItem>) {
    setDirty(true);
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  }

  function addCustomItem() {
    const description = newItem.trim();
    if (!description) return;
    setDirty(true);
    setItems((current) => [
      ...current,
      { key: `custom-${Date.now()}`, category: 'Other findings', description, result: 'ATTENTION_NEEDED', notes: '' },
    ]);
    setNewItem('');
  }

  function submit(complete: boolean) {
    setError(null);
    setPendingKind(complete ? 'complete' : 'save');
    startTransition(async () => {
      const payload = {
        summary,
        items: items.map(({ category, description, result, notes }) => ({ category, description, result, notes })),
      };
      const result = await saveInspectionAction(jobCardId, inspectionId, payload, complete);
      setPendingKind(null);
      if (!result.ok) {
        setError(result.error ?? 'Could not save the inspection.');
        return;
      }
      setDirty(false);
      if (complete) {
        toast.success('Inspection completed');
        router.push(`/job-cards/${jobCardId}/diagnosis`);
      } else {
        toast.success('Progress saved');
        router.refresh();
      }
    });
  }

  const missingNotes = items.some(
    (item) => (item.result === 'ATTENTION_NEEDED' || item.result === 'FAILED') && item.notes.trim() === '',
  );

  return (
    <div className="flex flex-col gap-8">
      {categories.map((category) => (
        <section key={category} className="flex flex-col gap-4">
          <h2 className="text-base font-semibold tracking-tight">{category}</h2>
          <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-xs">
            {items
              .filter((item) => item.category === category)
              .map((item) => {
                const needsNote = item.result === 'ATTENTION_NEEDED' || item.result === 'FAILED';
                return (
                  <li key={item.key} className="flex flex-col gap-3 px-4 py-4 sm:px-6">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <p className="text-sm font-medium md:text-base">{item.description}</p>
                      <div role="radiogroup" aria-label={item.description} className="grid grid-cols-4 gap-2 md:w-[26rem]">
                        {CHOICES.map((choice) => {
                          const selected = item.result === choice.value;
                          return (
                            <button
                              key={choice.value}
                              type="button"
                              role="radio"
                              aria-checked={selected}
                              onClick={() => update(item.key, { result: choice.value })}
                              className={cn(
                                'h-11 rounded-lg border px-2 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                                selected ? choice.active : 'border-border bg-background text-muted-foreground hover:bg-muted',
                              )}
                            >
                              {choice.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    {needsNote || item.notes ? (
                      <div className="flex flex-col gap-2">
                        <label htmlFor={`notes-${item.key}`} className="text-xs font-medium text-muted-foreground">
                          {needsNote ? 'What did you find? (required)' : 'Notes'}
                        </label>
                        <Textarea
                          id={`notes-${item.key}`}
                          value={item.notes}
                          onChange={(event) => update(item.key, { notes: event.target.value })}
                          placeholder="e.g. Front pads at 3 mm, disc scored"
                          className={cn('min-h-20 text-base md:text-sm', needsNote && !item.notes.trim() && 'border-warning')}
                        />
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => update(item.key, { notes: ' ' })}
                        className="self-start text-xs font-medium text-primary hover:underline"
                      >
                        Add a note
                      </button>
                    )}
                  </li>
                );
              })}
          </ul>
        </section>
      ))}

      <section className="flex flex-col gap-4">
        <h2 className="text-base font-semibold tracking-tight">Add another finding</h2>
        <div className="flex gap-3">
          <Input
            value={newItem}
            onChange={(event) => setNewItem(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                addCustomItem();
              }
            }}
            placeholder="e.g. Rear bumper sensor"
            className="h-11 text-base md:text-sm"
          />
          <Button type="button" variant="outline" size="lg" className="h-11" onClick={addCustomItem}>
            <Plus />
            Add
          </Button>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-semibold tracking-tight">Inspection summary</h2>
          <p className="text-sm text-muted-foreground">
            A short overview for the service advisor. Photos can be attached once file storage is configured.
          </p>
        </div>
        <Textarea
          value={summary}
          onChange={(event) => {
            setDirty(true);
            setSummary(event.target.value);
          }}
          placeholder="e.g. AC not cooling — compressor clutch not engaging. Front brake pads worn."
          className="min-h-28 text-base md:text-sm"
        />
      </section>

      <FormError message={error ?? undefined} />

      {/* Sticky action bar: always reachable on a tablet */}
      <div className="sticky bottom-0 z-20 -mx-4 -mb-12 border-t border-border bg-background/95 backdrop-blur sm:-mx-6 lg:-mx-10 lg:-mb-16">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-10">
          <p className="text-sm text-muted-foreground">
            <span className="font-semibold text-success">{counts.OK} pass</span> ·{' '}
            <span className="font-semibold text-warning">{counts.ATTENTION_NEEDED} attention</span> ·{' '}
            <span className="font-semibold text-danger">{counts.FAILED} fail</span> · {counts.NOT_CHECKED} not checked
            {dirty ? <span className="ml-2 text-foreground">· Unsaved changes</span> : null}
          </p>
          <div className="flex gap-3">
            <Button variant="outline" size="lg" className="h-11" disabled={isPending} onClick={() => submit(false)}>
              {pendingKind === 'save' ? <Loader2 className="animate-spin" /> : <Save />}
              Save progress
            </Button>
            <ConfirmAction
              trigger={
                <Button size="lg" className="h-11" disabled={isPending || missingNotes}>
                  {pendingKind === 'complete' ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
                  Complete inspection
                </Button>
              }
              title="Complete the inspection?"
              description="The checklist is locked once completed, and the job moves on to diagnosis."
              confirmLabel="Complete inspection"
              tone="default"
              onConfirm={async () => submit(true)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
