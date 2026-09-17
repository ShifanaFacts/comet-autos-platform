'use client';

import { useActionState } from 'react';
import { ClipboardCheck } from 'lucide-react';
import { Field, FormError, NativeSelect } from '@/components/forms/fields';
import { SubmitButton } from '@/components/forms/submit-button';
import type { EmployeeOption } from '@/components/workshop/technician-form';
import type { ActionResult } from '@/lib/errors';
import { startInspectionAction } from '../actions';

export function StartInspectionForm({
  jobCardId,
  employees,
  defaultEmployeeId,
}: {
  jobCardId: string;
  employees: EmployeeOption[];
  defaultEmployeeId: string | null;
}) {
  const [state, formAction] = useActionState<ActionResult, FormData>(startInspectionAction.bind(null, jobCardId), {
    ok: false,
  });

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <Field label="Inspected by" htmlFor="employeeId" required hint="Defaults to the technician assigned to this job.">
        <NativeSelect id="employeeId" name="employeeId" defaultValue={defaultEmployeeId ?? ''} required className="h-11 text-base md:text-sm">
          <option value="" disabled>
            Choose who is inspecting…
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
      <SubmitButton size="lg" className="h-11 self-start" pendingLabel="Starting…">
        <ClipboardCheck />
        Start inspection
      </SubmitButton>
    </form>
  );
}
