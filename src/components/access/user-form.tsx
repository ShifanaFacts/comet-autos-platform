'use client';

import { useState } from 'react';
import { Info, Save, ShieldCheck, TriangleAlert, UserPlus } from 'lucide-react';
import { Field, FormError, NativeSelect, TextField } from '@/components/forms/fields';
import { SubmitButton } from '@/components/forms/submit-button';
import { useFormAction } from '@/components/forms/use-form-action';
import type { ActionResult } from '@/lib/errors';
import { createUserAction, updateUserAction } from '@/app/(app)/settings/users/actions';
import { cn } from '@/lib/utils';

const INPUT = '[&_input]:h-11 [&_input]:text-base md:[&_input]:text-sm';

export interface AccessOptions {
  roles: { id: string; name: string; description: string | null; isSystem: boolean }[];
  branches: { id: string; name: string; code: string }[];
  employees: { id: string; employeeCode: string; firstName: string; lastName: string; jobTitle: string | null }[];
}

export interface UserFormValues {
  id?: string;
  fullName: string;
  email: string;
  phone: string;
  primaryBranchId: string;
  roleIds: string[];
  employeeId: string;
}

/**
 * One form for creating and for editing. Creating also sets the first
 * password and can link an employee record; editing does neither — a
 * password is changed through Reset password, and the employee link is
 * one-to-one for the life of the account.
 */
export function UserForm({
  mode,
  options,
  initial,
  isSelf,
}: {
  mode: 'create' | 'edit';
  options: AccessOptions;
  initial: UserFormValues;
  /** Editing your own account: your roles are not yours to change. */
  isSelf?: boolean;
}) {
  const [roleIds, setRoleIds] = useState<string[]>(initial.roleIds);
  const [state, onSubmit, isPending] = useFormAction<ActionResult>(
    mode === 'create'
      ? createUserAction
      : (prev, formData) => updateUserAction(initial.id!, prev, formData),
    { ok: false },
  );
  const errors = state.fieldErrors ?? {};

  function toggleRole(id: string) {
    setRoleIds((current) =>
      current.includes(id) ? current.filter((roleId) => roleId !== id) : [...current, id],
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-8">
      <fieldset className="flex flex-col gap-6">
        <legend className="sr-only">Person</legend>
        <div className="grid gap-6 sm:grid-cols-2">
          <TextField
            label="Full name"
            name="fullName"
            required
            autoComplete="name"
            defaultValue={initial.fullName}
            error={errors.fullName}
            className={INPUT}
          />
          <TextField
            label="Email"
            name="email"
            type="email"
            inputMode="email"
            required
            autoComplete="email"
            defaultValue={initial.email}
            error={errors.email}
            hint="They sign in with this."
            className={INPUT}
          />
        </div>
        <div className="grid gap-6 sm:grid-cols-2">
          <TextField
            label="Mobile"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            defaultValue={initial.phone}
            error={errors.phone}
            hint="Optional. Can also be used to sign in."
            className={INPUT}
          />
          <Field label="Branch" htmlFor="primaryBranchId" error={errors.primaryBranchId}>
            <NativeSelect
              id="primaryBranchId"
              name="primaryBranchId"
              defaultValue={initial.primaryBranchId}
              className="h-11 text-base md:text-sm"
            >
              <option value="">All branches</option>
              {options.branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>

        {mode === 'create' ? (
          <Field
            label="Employee record"
            htmlFor="employeeId"
            error={errors.employeeId}
            hint="Optional. Links this login to a person on the team — one login per employee."
          >
            <NativeSelect
              id="employeeId"
              name="employeeId"
              defaultValue={initial.employeeId}
              className="h-11 text-base md:text-sm"
            >
              <option value="">Not linked to an employee</option>
              {options.employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.firstName} {employee.lastName} · {employee.employeeCode}
                  {employee.jobTitle ? ` · ${employee.jobTitle}` : ''}
                </option>
              ))}
            </NativeSelect>
          </Field>
        ) : null}
      </fieldset>

      {mode === 'create' ? (
        <fieldset className="flex flex-col gap-6 border-t border-border pt-8">
          <legend className="sr-only">First password</legend>
          <TextField
            label="First password"
            name="password"
            type="password"
            required
            autoComplete="new-password"
            error={errors.password}
            hint="At least 10 characters with a number. Give it to them in person — they can change it on their account page."
            className={INPUT}
          />
        </fieldset>
      ) : null}

      <fieldset className="flex flex-col gap-4 border-t border-border pt-8">
        <legend className="sr-only">Roles</legend>
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">
            Roles <span className="text-danger">*</span>
          </p>
          <p className="text-xs text-muted-foreground">
            What they can do is the sum of the roles they hold.
          </p>
        </div>

        {isSelf ? (
          <p className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            These are your own roles. Ask another administrator to change them — it stops anyone
            locking themselves out by accident.
          </p>
        ) : null}

        <div className="grid gap-2 sm:grid-cols-2">
          {options.roles.map((role) => {
            const checked = roleIds.includes(role.id);
            return (
              <label
                key={role.id}
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3.5 transition-colors',
                  checked ? 'border-primary bg-primary/5' : 'border-border bg-card hover:bg-muted/50',
                  isSelf && 'cursor-not-allowed opacity-60',
                )}
              >
                <input
                  type="checkbox"
                  name="roleIds"
                  value={role.id}
                  checked={checked}
                  disabled={isSelf}
                  onChange={() => toggleRole(role.id)}
                  className="mt-0.5 size-5 shrink-0 accent-primary"
                />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    {role.isSystem ? <ShieldCheck className="size-3.5 text-primary" /> : null}
                    {role.name}
                  </span>
                  {role.description ? (
                    <span className="text-xs text-muted-foreground">{role.description}</span>
                  ) : null}
                </span>
              </label>
            );
          })}
        </div>
        {/* Disabled inputs post nothing, so the unchanged roles travel with the form. */}
        {isSelf
          ? roleIds.map((id) => <input key={id} type="hidden" name="roleIds" value={id} />)
          : null}

        {errors.roleIds ? (
          <p role="alert" className="flex items-start gap-2 text-xs text-danger">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            {errors.roleIds}
          </p>
        ) : null}
        {options.roles.length === 0 ? (
          <p className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2.5 text-xs text-warning">
            No roles exist yet. Create one under Roles & permissions first.
          </p>
        ) : null}
      </fieldset>

      <FormError message={Object.keys(errors).length ? undefined : state.error} />

      <div className="border-t border-border pt-6">
        <SubmitButton
          pending={isPending}
          size="lg"
          className="h-12 w-full sm:h-11 sm:w-auto"
          pendingLabel={mode === 'create' ? 'Creating…' : 'Saving…'}
        >
          {mode === 'create' ? <UserPlus /> : <Save />}
          {mode === 'create' ? 'Create user' : 'Save changes'}
        </SubmitButton>
      </div>
    </form>
  );
}
