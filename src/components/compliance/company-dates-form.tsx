'use client';

import { useRouter } from 'next/navigation';
import { Save } from 'lucide-react';
import { toast } from 'sonner';
import { Field, FormError, NativeSelect, TextField } from '@/components/forms/fields';
import { SubmitButton } from '@/components/forms/submit-button';
import { useFormAction } from '@/components/forms/use-form-action';
import type { ActionResult } from '@/lib/errors';
import type { CompanyDates } from '@/lib/compliance/calendar';
import { saveCompanyDatesAction } from '@/app/(app)/finance/calendar/actions';

const INPUT = '[&_input]:h-11 [&_input]:text-base md:[&_input]:text-sm';
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * The company's dates, each with where to find it. Entered once; the
 * calendar works everything else out from them.
 */
export function CompanyDatesForm({ dates }: { dates: CompanyDates }) {
  const router = useRouter();
  const [state, onSubmit, isPending] = useFormAction<ActionResult>(
    async (prev, formData) => {
      const result = await saveCompanyDatesAction(prev, formData);
      if (result.ok) {
        toast.success('Company dates saved');
        router.refresh();
      }
      return result;
    },
    { ok: false },
  );
  const errors = state.fieldErrors ?? {};

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-8">
      <fieldset className="flex flex-col gap-4">
        <legend className="mb-2 text-sm font-semibold">VAT return periods</legend>
        <p className="text-xs text-muted-foreground">
          From the VAT registration certificate: in EmaraTax (tax.gov.ae) open VAT, then the
          certificate. It gives the first tax period and how often you file.
        </p>
        <div className="grid gap-6 @lg:grid-cols-3">
          <TextField
            label="First period starts"
            name="vatFirstPeriodStart"
            type="date"
            defaultValue={dates.vatFirstPeriodStart ?? ''}
            error={errors.vatFirstPeriodStart}
            className={INPUT}
          />
          <TextField
            label="First period ends"
            name="vatFirstPeriodEnd"
            type="date"
            defaultValue={dates.vatFirstPeriodEnd ?? ''}
            error={errors.vatFirstPeriodEnd}
            className={INPUT}
          />
          <Field label="Returns are filed" htmlFor="vatPeriodMonths" error={errors.vatPeriodMonths}>
            <NativeSelect
              id="vatPeriodMonths"
              name="vatPeriodMonths"
              defaultValue={dates.vatPeriodMonths ? String(dates.vatPeriodMonths) : ''}
              className="h-11 text-base md:text-sm"
            >
              <option value="">Not set</option>
              <option value="3">Every 3 months (quarterly)</option>
              <option value="1">Every month</option>
            </NativeSelect>
          </Field>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-4 border-t border-border pt-6">
        <legend className="mb-2 text-sm font-semibold">Financial year</legend>
        <p className="text-xs text-muted-foreground">
          Written in the Memorandum of Association, and on the corporate tax registration. Most UAE
          companies end their year on 31 December. The first year can be shorter or longer than
          twelve months — enter its end if so.
        </p>
        <div className="grid gap-6 @lg:grid-cols-2">
          <Field
            label="The year ends in"
            htmlFor="financialYearEndMonth"
            error={errors.financialYearEndMonth}
          >
            <NativeSelect
              id="financialYearEndMonth"
              name="financialYearEndMonth"
              defaultValue={dates.financialYearEndMonth ? String(dates.financialYearEndMonth) : ''}
              className="h-11 text-base md:text-sm"
            >
              <option value="">Not set</option>
              {MONTHS.map((month, index) => (
                <option key={month} value={String(index + 1)}>
                  {month} (year ends on the last day)
                </option>
              ))}
            </NativeSelect>
          </Field>
          <TextField
            label="First year ends (if not twelve months)"
            name="firstFinancialYearEnd"
            type="date"
            defaultValue={dates.firstFinancialYearEnd ?? ''}
            error={errors.firstFinancialYearEnd}
            hint="Leave empty when the first year ends on the usual date."
            className={INPUT}
          />
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-4 border-t border-border pt-6">
        <legend className="mb-2 text-sm font-semibold">Corporate tax and licence</legend>
        <div className="grid gap-6 @lg:grid-cols-3">
          <TextField
            label="Corporate tax TRN"
            name="corporateTaxNumber"
            inputMode="numeric"
            defaultValue={dates.corporateTaxNumber ?? ''}
            error={errors.corporateTaxNumber}
            hint="From EmaraTax, once registered."
            className={INPUT}
          />
          <TextField
            label="Trade licence number"
            name="tradeLicenceNumber"
            defaultValue={dates.tradeLicenceNumber ?? ''}
            error={errors.tradeLicenceNumber}
            className={INPUT}
          />
          <TextField
            label="Licence expires"
            name="tradeLicenceExpiry"
            type="date"
            defaultValue={dates.tradeLicenceExpiry ?? ''}
            error={errors.tradeLicenceExpiry}
            className={INPUT}
          />
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-4 border-t border-border pt-6">
        <legend className="mb-2 text-sm font-semibold">Salaries (WPS)</legend>
        <p className="text-xs text-muted-foreground">
          For the salary file the bank pays the team from. The establishment number is on the MOHRE
          establishment card; the bank gives its routing code.
        </p>
        <div className="grid gap-6 @lg:grid-cols-2">
          <TextField
            label="MOHRE establishment number"
            name="mohreEstablishmentId"
            inputMode="numeric"
            defaultValue={dates.mohreEstablishmentId ?? ''}
            error={errors.mohreEstablishmentId}
            hint="13 digits."
            className={INPUT}
          />
          <TextField
            label="Paying bank's routing code"
            name="wpsRoutingCode"
            inputMode="numeric"
            defaultValue={dates.wpsRoutingCode ?? ''}
            error={errors.wpsRoutingCode}
            hint="9 digits."
            className={INPUT}
          />
        </div>
      </fieldset>

      <FormError message={Object.keys(errors).length ? undefined : state.error} />
      <div className="border-t border-border pt-6">
        <SubmitButton pending={isPending} size="lg" className="h-11" pendingLabel="Saving…">
          <Save />
          Save dates
        </SubmitButton>
      </div>
    </form>
  );
}
