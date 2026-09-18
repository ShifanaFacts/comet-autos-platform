'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import { FormError, TextField, TextareaField } from '@/components/forms/fields';
import { SubmitButton } from '@/components/forms/submit-button';
import { useFormAction } from '@/components/forms/use-form-action';
import { LinkButton } from '@/components/shared/link-button';
import type { ActionResult } from '@/lib/errors';
import { checkDuplicatePhoneAction } from '@/app/(app)/customers/actions';

export function CustomerForm({
  action,
  customerId,
  initial,
  submitLabel,
  cancelHref,
}: {
  action: (prev: ActionResult, formData: FormData) => Promise<ActionResult>;
  customerId?: string;
  initial?: { name: string; phone: string; email: string | null; address: string | null; taxNumber: string | null };
  submitLabel: string;
  cancelHref: string;
}) {
  const [state, onSubmit, isPending] = useFormAction<ActionResult>(action, { ok: false });
  const [phone, setPhone] = useState(initial?.phone ?? '');
  const [duplicates, setDuplicates] = useState<{ id: string; name: string; phone: string }[]>([]);
  const errors = state.fieldErrors ?? {};

  useEffect(() => {
    if (phone.replace(/\D/g, '').length < 7 || phone === initial?.phone) return;
    const timeout = setTimeout(async () => setDuplicates(await checkDuplicatePhoneAction(phone, customerId)), 400);
    return () => clearTimeout(timeout);
  }, [phone, customerId, initial?.phone]);

  const showDuplicates = duplicates.length > 0 && phone !== initial?.phone && phone.replace(/\D/g, '').length >= 7;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <div className="grid gap-6 sm:grid-cols-2">
        <TextField label="Customer name" name="name" required defaultValue={initial?.name} error={errors.name} autoFocus />
        <TextField
          label="Mobile number"
          name="phone"
          type="tel"
          required
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          error={errors.phone}
          placeholder="050 123 4567"
        />
      </div>
      {showDuplicates ? (
        <div className="flex flex-col gap-2 rounded-lg border border-warning/30 bg-warning/5 px-4 py-3 text-sm">
          <p className="flex items-center gap-2 font-medium text-warning">
            <TriangleAlert className="size-4" />
            This mobile number is already on file
          </p>
          <ul className="flex flex-col gap-1">
            {duplicates.map((customer) => (
              <li key={customer.id}>
                <Link href={`/customers/${customer.id}`} className="font-medium underline-offset-4 hover:underline">
                  {customer.name}
                </Link>{' '}
                <span className="text-muted-foreground">· {customer.phone}</span>
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground">Check it isn&apos;t the same person before saving a new record.</p>
        </div>
      ) : null}
      <TextField
        label="Email"
        name="email"
        type="email"
        defaultValue={initial?.email ?? ''}
        error={errors.email}
        hint="Optional"
      />
      <TextareaField
        label="Address"
        name="address"
        defaultValue={initial?.address ?? ''}
        error={errors.address}
        hint="Optional"
        className="[&_textarea]:min-h-20"
      />
      <TextField
        label="Tax registration number (TRN)"
        name="taxNumber"
        defaultValue={initial?.taxNumber ?? ''}
        error={errors.taxNumber}
        hint="Optional — for business customers who need it on invoices."
      />
      <FormError message={state.error} />
      <div className="flex flex-wrap gap-3 border-t border-border pt-6">
        <SubmitButton pending={isPending} size="lg" pendingLabel="Saving…">
          {submitLabel}
        </SubmitButton>
        <LinkButton href={cancelHref} variant="ghost" size="lg">
          Cancel
        </LinkButton>
      </div>
    </form>
  );
}
