'use client';

import { useActionState } from 'react';
import { NativeSelect } from '@/components/forms/fields';
import { SubmitButton } from '@/components/forms/submit-button';
import { assignTechnicianAction } from '@/app/(app)/job-cards/[id]/actions';
import type { ActionResult } from '@/lib/errors';

export interface EmployeeOption {
  id: string;
  name: string;
  jobTitle: string | null;
}

export function TechnicianForm({
  jobCardId,
  employees,
  currentEmployeeId,
}: {
  jobCardId: string;
  employees: EmployeeOption[];
  currentEmployeeId: string | null;
}) {
  const [state, formAction] = useActionState<ActionResult, FormData>(
    assignTechnicianAction.bind(null, jobCardId),
    { ok: false },
  );

  if (employees.length === 0) {
    return <p className="text-sm text-muted-foreground">No active staff on file yet. Add employees before assigning work.</p>;
  }

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <label htmlFor="employeeId" className="sr-only">
        Technician
      </label>
      <div className="flex gap-2">
        <NativeSelect id="employeeId" name="employeeId" defaultValue={currentEmployeeId ?? ''} required className="flex-1">
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
        <SubmitButton variant={currentEmployeeId ? 'outline' : 'default'} pendingLabel="Saving…">
          {currentEmployeeId ? 'Change' : 'Assign'}
        </SubmitButton>
      </div>
      {state.error ? <p className="text-xs text-destructive">{state.error}</p> : null}
    </form>
  );
}
