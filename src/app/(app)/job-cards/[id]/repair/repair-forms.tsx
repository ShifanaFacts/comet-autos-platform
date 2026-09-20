'use client';

import { useMemo, useRef, useState } from 'react';
import { CheckCircle2, Plus, TriangleAlert, Undo2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import {
  Field,
  FormError,
  NativeSelect,
  TextField,
  TextareaField,
} from '@/components/forms/fields';
import { SubmitButton } from '@/components/forms/submit-button';
import { useFormAction } from '@/components/forms/use-form-action';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import type { EmployeeOption } from '@/components/workshop/technician-form';
import type { ActionResult } from '@/lib/errors';
import { calculateLabour, filsToString, formatMilli, multiplyQuantity } from '@/lib/money';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  createAdditionalEstimateAction,
  recordLabourAction,
  recordPartUsageAction,
  recordQualityCheckAction,
  returnPartAction,
} from '../actions';

export interface PartOption {
  id: string;
  sku: string;
  name: string;
  unitOfMeasure: string;
  sellingPrice: string | null;
  stockMilli: number;
}

export interface ApprovedLineOption {
  id: string;
  description: string;
  estimateNumber: string;
  remaining: string;
  unitPrice: string;
  done: boolean;
}

/** Resets the form after a successful save so the next entry starts clean. */
function useResettingAction(
  action: (prev: ActionResult, formData: FormData) => Promise<ActionResult>,
  message: string,
  onSuccess?: () => void,
) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, onSubmit, isPending] = useFormAction<ActionResult>(
    async (prev, formData) => {
      const result = await action(prev, formData);
      if (result.ok) {
        toast.success(message);
        formRef.current?.reset();
        onSuccess?.();
      }
      return result;
    },
    { ok: false },
  );
  return { formRef, state, onSubmit, isPending };
}

function EmployeeSelect({
  employees,
  defaultEmployeeId,
  label,
  error,
}: {
  employees: EmployeeOption[];
  defaultEmployeeId: string | null;
  label: string;
  error?: string;
}) {
  return (
    <Field label={label} htmlFor="employeeId" required error={error}>
      <NativeSelect
        id="employeeId"
        name="employeeId"
        defaultValue={defaultEmployeeId ?? ''}
        required
        className="h-11 text-base md:text-sm"
      >
        <option value="" disabled>
          Choose…
        </option>
        {employees.map((employee) => (
          <option key={employee.id} value={employee.id}>
            {employee.name}
            {employee.jobTitle ? ` — ${employee.jobTitle}` : ''}
          </option>
        ))}
      </NativeSelect>
    </Field>
  );
}

function AdditionalWarning() {
  return (
    <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-sm text-warning">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" />
      Recorded as additional work. It is not part of the approved quotation and won&apos;t be
      charged unless the customer approves an additional work request.
    </p>
  );
}

export function PartUsageForm({
  jobCardId,
  parts,
  approvedLines,
  employees,
  defaultEmployeeId,
}: {
  jobCardId: string;
  parts: PartOption[];
  approvedLines: ApprovedLineOption[];
  employees: EmployeeOption[];
  defaultEmployeeId: string | null;
}) {
  const [partId, setPartId] = useState('');
  const [lineId, setLineId] = useState(approvedLines.find((l) => !l.done)?.id ?? '');
  const [quantity, setQuantity] = useState('1');
  const { formRef, state, onSubmit, isPending } = useResettingAction(
    recordPartUsageAction.bind(null, jobCardId),
    'Part recorded and issued from stock',
    () => {
      setPartId('');
      setQuantity('1');
    },
  );
  const errors = state.fieldErrors ?? {};
  const part = parts.find((p) => p.id === partId);
  const preview = useMemo(() => {
    if (!part?.sellingPrice || !/^\d+(\.\d{1,3})?$/.test(quantity) || Number(quantity) <= 0)
      return null;
    return filsToString(multiplyQuantity(quantity, part.sellingPrice));
  }, [part, quantity]);

  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-6">
      <div className="grid gap-6 md:grid-cols-2">
        <Field label="Part" htmlFor="partId" required error={errors.partId}>
          <NativeSelect
            id="partId"
            name="partId"
            required
            value={partId}
            onChange={(e) => setPartId(e.target.value)}
            className="h-11 text-base md:text-sm"
          >
            <option value="" disabled>
              Choose a part…
            </option>
            {parts.map((p) => (
              <option key={p.id} value={p.id} disabled={p.stockMilli <= 0}>
                {p.name} · {p.sku} —{' '}
                {p.stockMilli > 0
                  ? `${formatMilli(p.stockMilli)} ${p.unitOfMeasure} in stock`
                  : 'out of stock'}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field
          label="For approved work"
          htmlFor="estimateItemId"
          error={errors.estimateItemId}
          hint="Which approved line this part fulfils."
        >
          <NativeSelect
            id="estimateItemId"
            name="estimateItemId"
            value={lineId}
            onChange={(e) => setLineId(e.target.value)}
            className="h-11 text-base md:text-sm"
          >
            {approvedLines.map((line) => (
              <option key={line.id} value={line.id}>
                {line.description} ({line.done ? 'done' : `${line.remaining} to fit`})
              </option>
            ))}
            <option value="">Additional work — not approved</option>
          </NativeSelect>
        </Field>
        <TextField
          label={`Quantity${part ? ` (${part.unitOfMeasure})` : ''}`}
          name="quantity"
          required
          inputMode="decimal"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          error={errors.quantity}
          className="[&_input]:h-11 [&_input]:text-base md:[&_input]:text-sm"
        />
        <EmployeeSelect
          employees={employees}
          defaultEmployeeId={defaultEmployeeId}
          label="Fitted by"
          error={errors.employeeId}
        />
      </div>
      {lineId === '' ? <AdditionalWarning /> : null}
      <FormError
        message={
          errors.partId || errors.quantity || errors.estimateItemId || errors.employeeId
            ? undefined
            : state.error
        }
      />
      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-4">
        <p className="text-sm text-muted-foreground">
          {part && preview
            ? `${formatMoney(part.sellingPrice!)} each · ${formatMoney(preview)} at today's price. Stock is issued immediately.`
            : 'Price and cost are taken from the part now and kept with this record.'}
        </p>
        <SubmitButton pending={isPending} size="lg" className="h-11" pendingLabel="Recording…">
          <Plus />
          Record part
        </SubmitButton>
      </div>
    </form>
  );
}

export function LabourForm({
  jobCardId,
  approvedLines,
  employees,
  defaultEmployeeId,
}: {
  jobCardId: string;
  approvedLines: ApprovedLineOption[];
  employees: EmployeeOption[];
  defaultEmployeeId: string | null;
}) {
  const first = approvedLines.find((l) => !l.done) ?? approvedLines[0];
  const [lineId, setLineId] = useState(first?.id ?? '');
  const [description, setDescription] = useState(first?.description ?? '');
  const [hours, setHours] = useState('');
  const [rate, setRate] = useState(first?.unitPrice ?? '');
  const { formRef, state, onSubmit, isPending } = useResettingAction(
    recordLabourAction.bind(null, jobCardId),
    'Labour recorded',
    () => setHours(''),
  );
  const errors = state.fieldErrors ?? {};
  const amount = useMemo(() => {
    try {
      return calculateLabour({ hours, rate }).amount;
    } catch {
      return null;
    }
  }, [hours, rate]);

  function chooseLine(id: string) {
    setLineId(id);
    const line = approvedLines.find((l) => l.id === id);
    if (line) {
      setDescription(line.description);
      setRate(line.unitPrice);
    }
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-6">
      <div className="grid gap-6 md:grid-cols-2">
        <Field
          label="For approved work"
          htmlFor="labourLine"
          error={errors.estimateItemId}
          hint="Fills in the approved description and rate."
        >
          <NativeSelect
            id="labourLine"
            name="estimateItemId"
            value={lineId}
            onChange={(e) => chooseLine(e.target.value)}
            className="h-11 text-base md:text-sm"
          >
            {approvedLines.map((line) => (
              <option key={line.id} value={line.id}>
                {line.description} ({line.done ? 'recorded' : `${line.remaining} h approved`})
              </option>
            ))}
            <option value="">Additional work — not approved</option>
          </NativeSelect>
        </Field>
        <EmployeeSelect
          employees={employees}
          defaultEmployeeId={defaultEmployeeId}
          label="Technician"
          error={errors.employeeId}
        />
        <TextField
          label="Work performed"
          name="description"
          required
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          error={errors.description}
          className="md:col-span-2 [&_input]:h-11 [&_input]:text-base md:[&_input]:text-sm"
        />
        <TextField
          label="Hours"
          name="hours"
          required
          inputMode="decimal"
          placeholder="e.g. 1.5"
          value={hours}
          onChange={(e) => setHours(e.target.value)}
          error={errors.hours}
          className="[&_input]:h-11 [&_input]:text-base md:[&_input]:text-sm"
        />
        <TextField
          label="Hourly rate (AED)"
          name="rate"
          required
          inputMode="decimal"
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          error={errors.rate}
          className="[&_input]:h-11 [&_input]:text-base md:[&_input]:text-sm"
        />
      </div>
      {lineId === '' ? <AdditionalWarning /> : null}
      <FormError message={Object.keys(errors).length ? undefined : state.error} />
      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-4">
        <p className="text-sm text-muted-foreground">
          {amount ? (
            <>
              Billable amount{' '}
              <span className="font-semibold text-foreground tabular-nums">
                {formatMoney(amount)}
              </span>{' '}
              (checked again on the server)
            </>
          ) : (
            'Billable amount = hours × rate.'
          )}
        </p>
        <SubmitButton pending={isPending} size="lg" className="h-11" pendingLabel="Recording…">
          <Plus />
          Record labour
        </SubmitButton>
      </div>
    </form>
  );
}

export function QualityCheckForm({
  jobCardId,
  employees,
  defaultEmployeeId,
  remainingCount,
}: {
  jobCardId: string;
  employees: EmployeeOption[];
  defaultEmployeeId: string | null;
  remainingCount: number;
}) {
  const [result, setResult] = useState<'PASSED' | 'FAILED' | null>(null);
  const { formRef, state, onSubmit, isPending } = useResettingAction(
    recordQualityCheckAction.bind(null, jobCardId),
    result === 'PASSED'
      ? 'Quality check passed — ready for collection'
      : 'Quality check failed — sent back to repair',
    () => setResult(null),
  );
  const errors = state.fieldErrors ?? {};

  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-6">
      {remainingCount > 0 ? (
        <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-sm text-warning">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          {remainingCount} approved line{remainingCount === 1 ? ' is' : 's are'} not complete. The
          job can only pass once all approved work is done — you can still fail it and send it back
          to repair.
        </p>
      ) : null}
      <input type="hidden" name="result" value={result ?? ''} />
      <div role="radiogroup" aria-label="Quality check result" className="grid grid-cols-2 gap-3">
        {(['PASSED', 'FAILED'] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={result === value}
            disabled={value === 'PASSED' && remainingCount > 0}
            onClick={() => setResult(value)}
            className={cn(
              'flex h-12 items-center justify-center gap-2 rounded-lg border text-sm font-semibold transition-colors',
              result === value
                ? value === 'PASSED'
                  ? 'border-success bg-success text-success-foreground'
                  : 'border-danger bg-danger text-danger-foreground'
                : 'border-border bg-background text-muted-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50',
            )}
          >
            {value === 'PASSED' ? (
              <CheckCircle2 className="size-4" />
            ) : (
              <XCircle className="size-4" />
            )}
            {value === 'PASSED' ? 'Pass' : 'Fail'}
          </button>
        ))}
      </div>
      {errors.result ? <p className="text-xs text-destructive">{errors.result}</p> : null}
      <div className="grid gap-6 md:grid-cols-2">
        <EmployeeSelect
          employees={employees}
          defaultEmployeeId={defaultEmployeeId}
          label="Checked by"
          error={errors.employeeId}
        />
      </div>
      {result === 'FAILED' ? (
        <TextareaField
          label="What must be corrected?"
          name="correctionsRequired"
          required
          error={errors.correctionsRequired}
          placeholder="e.g. Brake pedal feels soft — bleed the front brakes again."
          className="[&_textarea]:text-base md:[&_textarea]:text-sm"
        />
      ) : null}
      <TextareaField
        label="Notes"
        name="notes"
        error={errors.notes}
        placeholder="e.g. Road tested 10 km, AC vent temperature 6°C."
        className="[&_textarea]:min-h-20 [&_textarea]:text-base md:[&_textarea]:text-sm"
      />
      <FormError message={Object.keys(errors).length ? undefined : state.error} />
      <div className="border-t border-border pt-4">
        <SubmitButton
          pending={isPending}
          size="lg"
          className="h-11"
          variant={result === 'FAILED' ? 'destructive' : 'default'}
          disabled={!result}
          pendingLabel="Saving…"
        >
          {result === 'FAILED'
            ? 'Record failure & send back to repair'
            : result === 'PASSED'
              ? 'Pass & mark ready for collection'
              : 'Choose pass or fail'}
        </SubmitButton>
      </div>
    </form>
  );
}

export function AdditionalWorkForm({ jobCardId }: { jobCardId: string }) {
  const [state, onSubmit, isPending] = useFormAction<ActionResult>(
    createAdditionalEstimateAction.bind(null, jobCardId),
    { ok: false },
  );
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <TextareaField
        label="What was found?"
        name="notes"
        required
        error={state.fieldErrors?.notes}
        placeholder="e.g. Water pump leaking — found while replacing the AC clutch. Needs replacement."
        hint="The customer sees this with the price for the extra work."
        className="[&_textarea]:min-h-20 [&_textarea]:text-base md:[&_textarea]:text-sm"
      />
      <FormError message={state.fieldErrors?.notes ? undefined : state.error} />
      <SubmitButton
        pending={isPending}
        variant="outline"
        size="lg"
        className="h-11 self-start"
        pendingLabel="Opening…"
      >
        Price additional work
      </SubmitButton>
    </form>
  );
}

/**
 * Takes a part recorded on this job back into stock — wrong part, or fewer
 * used than recorded. Posts a return to the stock history; the original
 * record is kept, so the correction is visible.
 */
export function ReturnPartButton({
  jobCardId,
  partUsageId,
  partName,
  onJobMilli,
  unit,
}: {
  jobCardId: string;
  partUsageId: string;
  partName: string;
  onJobMilli: number;
  unit: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, onSubmit, isPending] = useFormAction<ActionResult>(
    async (prev, formData) => {
      const result = await returnPartAction(jobCardId, partUsageId, prev, formData);
      if (result.ok) {
        toast.success('Part taken back into stock');
        setOpen(false);
      }
      return result;
    },
    { ok: false },
  );
  const errors = state.fieldErrors ?? {};

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="ghost" size="sm" className="h-11 text-muted-foreground sm:h-8">
            <Undo2 />
            Take back
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Take {partName} back into stock?</DialogTitle>
          <DialogDescription>
            {formatMilli(onJobMilli)} {unit} is recorded on this job. The return is added to the
            stock history and the job; the original record is kept.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-5">
          <TextField
            label={`Quantity (${unit})`}
            name="quantity"
            inputMode="decimal"
            required
            defaultValue={formatMilli(onJobMilli)}
            error={errors.quantity}
            className="[&_input]:h-11 [&_input]:text-base md:[&_input]:text-sm"
          />
          <TextField
            label="Reason"
            name="reason"
            required
            error={errors.reason}
            placeholder="e.g. Wrong part — fits the 2019 model only"
            className="[&_input]:h-11"
          />
          <FormError message={Object.keys(errors).length ? undefined : state.error} />
          <SubmitButton
            pending={isPending}
            size="lg"
            className="h-11 self-start"
            pendingLabel="Saving…"
          >
            <Undo2 />
            Take back into stock
          </SubmitButton>
        </form>
      </DialogContent>
    </Dialog>
  );
}
