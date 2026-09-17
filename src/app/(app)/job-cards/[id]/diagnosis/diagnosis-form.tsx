'use client';

import { useFormAction } from '@/components/forms/use-form-action';
import { ArrowRight } from 'lucide-react';
import { Field, FormError, NativeSelect, TextareaField } from '@/components/forms/fields';
import { SubmitButton } from '@/components/forms/submit-button';
import type { EmployeeOption } from '@/components/workshop/technician-form';
import type { ActionResult } from '@/lib/errors';
import { saveDiagnosisAction } from '../actions';

export function DiagnosisForm({
  jobCardId,
  employees,
  initial,
  isCorrection,
}: {
  jobCardId: string;
  employees: EmployeeOption[];
  initial: { employeeId: string | null; findings: string; recommendedAction: string };
  isCorrection: boolean;
}) {
  const [state, onSubmit, isPending] = useFormAction<ActionResult>(saveDiagnosisAction.bind(null, jobCardId), { ok: false });
  const errors = state.fieldErrors ?? {};

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <TextareaField
        label="Diagnosis"
        name="findings"
        required
        defaultValue={initial.findings}
        error={errors.findings}
        hint="What is actually wrong, and how you confirmed it."
        placeholder="e.g. AC compressor clutch coil open circuit — confirmed with multimeter, no continuity."
        className="[&_textarea]:min-h-32 [&_textarea]:text-base md:[&_textarea]:text-sm"
      />
      <TextareaField
        label="Recommended work"
        name="recommendedAction"
        required
        defaultValue={initial.recommendedAction}
        error={errors.recommendedAction}
        hint="This is what the estimate will price."
        placeholder="e.g. Replace compressor clutch assembly and recharge AC gas. Replace front brake pads."
        className="[&_textarea]:min-h-32 [&_textarea]:text-base md:[&_textarea]:text-sm"
      />
      <Field label="Diagnosed by" htmlFor="employeeId" required error={errors.employeeId}>
        <NativeSelect id="employeeId" name="employeeId" defaultValue={initial.employeeId ?? ''} required className="h-11 text-base md:text-sm">
          <option value="" disabled>
            Choose technician…
          </option>
          {employees.map((employee) => (
            <option key={employee.id} value={employee.id}>
              {employee.name}
              {employee.jobTitle ? ` — ${employee.jobTitle}` : ''}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <FormError message={state.error} />
      <SubmitButton pending={isPending} size="lg" className="h-11 self-start" pendingLabel="Saving…">
        {isCorrection ? 'Save correction' : 'Save diagnosis & create estimate'}
        <ArrowRight />
      </SubmitButton>
    </form>
  );
}
