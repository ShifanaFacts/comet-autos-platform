'use client';

import { Field, FormError, NativeSelect, TextField } from '@/components/forms/fields';
import { SubmitButton } from '@/components/forms/submit-button';
import { useFormAction } from '@/components/forms/use-form-action';
import { LinkButton } from '@/components/shared/link-button';
import type { ActionResult } from '@/lib/errors';

const INPUT = '[&_input]:h-11 [&_input]:text-base md:[&_input]:text-sm';

export interface EmployeeFormOptions {
  branches: { id: string; name: string }[];
  users: { id: string; fullName: string; email: string }[];
}

export function EmployeeForm({
  action,
  options,
  initial,
  cancelHref,
}: {
  action: (prev: ActionResult, formData: FormData) => Promise<ActionResult>;
  options: EmployeeFormOptions;
  initial?: {
    firstName: string;
    lastName: string;
    employeeCode: string;
    jobTitle: string | null;
    department: string | null;
    hireDate: string;
    terminationDate: string | null;
    branchId: string;
    userId: string | null;
    isActive: boolean;
  };
  cancelHref: string;
}) {
  const [state, onSubmit, isPending] = useFormAction<ActionResult>(action, { ok: false });
  const errors = state.fieldErrors ?? {};

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-8">
      <fieldset className="flex flex-col gap-6">
        <legend className="sr-only">Who they are</legend>
        <div className="grid gap-6 sm:grid-cols-2">
          <TextField
            label="First name"
            name="firstName"
            required
            defaultValue={initial?.firstName}
            error={errors.firstName}
            autoFocus={!initial}
            autoComplete="given-name"
            className={INPUT}
          />
          <TextField
            label="Last name"
            name="lastName"
            required
            defaultValue={initial?.lastName}
            error={errors.lastName}
            autoComplete="family-name"
            className={INPUT}
          />
        </div>
        <div className="grid gap-6 sm:grid-cols-2">
          <TextField
            label="Employee code"
            name="employeeCode"
            required
            defaultValue={initial?.employeeCode}
            error={errors.employeeCode}
            hint="How the workshop refers to them, e.g. EMP-004."
            className={INPUT}
          />
          <TextField
            label="Job title"
            name="jobTitle"
            defaultValue={initial?.jobTitle ?? ''}
            error={errors.jobTitle}
            hint="e.g. Senior Technician."
            className={INPUT}
          />
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-6 border-t border-border pt-8">
        <legend className="sr-only">Where they work</legend>
        <div className="grid gap-6 sm:grid-cols-2">
          <Field label="Branch" htmlFor="branchId" required error={errors.branchId}>
            <NativeSelect
              id="branchId"
              name="branchId"
              required
              defaultValue={initial?.branchId ?? options.branches[0]?.id ?? ''}
              className="h-11 text-base md:text-sm"
            >
              {options.branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <TextField
            label="Department"
            name="department"
            defaultValue={initial?.department ?? ''}
            error={errors.department}
            className={INPUT}
          />
        </div>
        <div className="grid gap-6 sm:grid-cols-2">
          <TextField
            label="Joined"
            name="hireDate"
            type="date"
            required
            defaultValue={initial?.hireDate}
            error={errors.hireDate}
            className={INPUT}
          />
          <TextField
            label="Left"
            name="terminationDate"
            type="date"
            defaultValue={initial?.terminationDate ?? ''}
            error={errors.terminationDate}
            hint="Leave empty while they still work here."
            className={INPUT}
          />
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-6 border-t border-border pt-8">
        <legend className="sr-only">System access</legend>
        <Field
          label="System login"
          htmlFor="userId"
          error={errors.userId}
          hint="Optional. A technician who never signs in is still recorded against their work."
        >
          <NativeSelect
            id="userId"
            name="userId"
            defaultValue={initial?.userId ?? ''}
            className="h-11 text-base md:text-sm"
          >
            <option value="">No login</option>
            {options.users.map((account) => (
              <option key={account.id} value={account.id}>
                {account.fullName} — {account.email}
              </option>
            ))}
          </NativeSelect>
        </Field>
        {initial ? (
          <Field
            label="Status"
            htmlFor="isActive"
            hint="An inactive employee keeps all their work history."
          >
            <NativeSelect
              id="isActive"
              name="isActive"
              defaultValue={initial.isActive ? 'true' : 'false'}
              className="h-11 text-base md:text-sm"
            >
              <option value="true">Working here</option>
              <option value="false">No longer working here</option>
            </NativeSelect>
          </Field>
        ) : null}
      </fieldset>

      <FormError message={Object.keys(errors).length ? undefined : state.error} />
      <div className="flex flex-wrap gap-3 border-t border-border pt-6">
        <SubmitButton pending={isPending} size="lg" className="h-11" pendingLabel="Saving…">
          {initial ? 'Save changes' : 'Add employee'}
        </SubmitButton>
        <LinkButton href={cancelHref} variant="ghost" size="lg" className="h-11">
          Cancel
        </LinkButton>
      </div>
    </form>
  );
}
