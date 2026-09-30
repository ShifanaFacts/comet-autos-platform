'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Save } from 'lucide-react';
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
import type { ActionResult } from '@/lib/errors';
import { recordExpenseAction, updateExpenseAction } from '@/app/(app)/finance/actions';
import { formatMoney, localDateString } from '@/lib/format';
import { calculateLine, filsToString, toFils } from '@/lib/money';
import { MoneyAccountField } from '@/components/accounting/money-account-field';
import type { AccountChoice } from '@/lib/accounting/reports';
import type { TaxCodeOption } from '@/lib/accounting/tax-codes';
import type { PaymentModeOption } from '@/lib/accounting/payment-modes';
import { modeFor, PaymentModeField } from '@/components/accounting/payment-mode-field';

/** An expense being corrected, as the form's starting values. */
export interface ExpenseDraft {
  id: string;
  description: string;
  amount: string;
  taxRate: string;
  /** The VAT as recorded — the bill's own figure when it was typed. */
  taxAmount?: string;
  /** The tax code saved on it; blank for an expense recorded before tax codes. */
  taxCodeId: string;
  /** YYYY-MM-DD */
  expenseDate: string;
  vendorName: string;
  /** The supplier's own bill / invoice number. */
  billNumber?: string;
  /** The supplier's TRN from their tax invoice. */
  supplierTrn?: string;
  /** Not paid yet: when it is due. YYYY-MM-DD */
  dueDate?: string;
  /** The transfer, cheque or card-slip number it was paid with. */
  paymentReference?: string;
  notes?: string;
  paymentMethod: string;
  paidFromAccountId: string;
  /** Paid with an owner's own money: who. */
  paidByUserId?: string;
  categoryId: string;
}

const INPUT = '[&_input]:h-11 [&_input]:text-base md:[&_input]:text-sm';
/** A value read from a scanned bill that needs checking. */
const AMBER = '[&_input]:border-warning [&_input]:ring-2 [&_input]:ring-warning/40';

/**
 * The code the form opens on: the expense's own; for one recorded before tax
 * codes, the standard code at its rate (or out of scope when it had no VAT);
 * for a new expense, the default.
 */
function startingCode(codes: TaxCodeOption[], expense?: ExpenseDraft) {
  if (!expense) return (codes.find((code) => code.isDefault) ?? codes[0]).id;
  if (expense.taxCodeId) return expense.taxCodeId;
  const rate = Number(expense.taxRate || 0);
  const match =
    rate > 0
      ? codes.find((code) => code.treatment === 'STANDARD' && Number(code.rate) === rate)
      : codes.find((code) => code.treatment === 'OUT_OF_SCOPE');
  return (match ?? codes[0]).id;
}

const MONEY = /^\d{1,9}(\.\d{1,2})?$/;

/** The VAT the rate gives on an amount, exactly as the server works it out; '' until both are valid. */
function vatOn(amount: string, rate: string): string {
  if (!MONEY.test(amount.trim()) || !rate || Number(rate) <= 0)
    return MONEY.test(amount.trim()) ? '0.00' : '';
  try {
    return calculateLine({ quantity: '1', unitPrice: amount.trim(), taxRate: rate }).taxAmount;
  } catch {
    return '';
  }
}

/** The rate a tax code charges: nothing for zero-rated, exempt or out of scope. */
function rateOfCode(codes: TaxCodeOption[], id: string) {
  const code = codes.find((option) => option.id === id);
  return code && Number(code.rate) > 0 ? code.rate : '';
}

/** Today in the workshop's own date terms, for the date field's default. */
function today() {
  return localDateString();
}

export function ExpenseForm({
  categories,
  defaultVatRate,
  moneyAccounts = [],
  taxCodes = [],
  modes = [],
  people = [],
  expense,
  prefill,
  flags = {},
  hidden = {},
  submit,
  onDone,
}: {
  categories: { id: string; accountCode: string; accountName: string }[];
  defaultVatRate: string;
  /** Cash and bank accounts it can be paid from. */
  moneyAccounts?: AccountChoice[];
  /** The purchase tax codes. Given, the VAT is chosen by code instead of typed. */
  taxCodes?: TaxCodeOption[];
  /** The payment modes (payment mode master). Given, one choice sets method and account. */
  modes?: PaymentModeOption[];
  /** Owners who can pay a cost with their own money: "Paid personally by…". */
  people?: { id: string; name: string }[];
  /** Set to correct an existing expense instead of recording a new one. */
  expense?: ExpenseDraft;
  /** Starting values for a new expense (Scan bill). Anything left out starts empty. */
  prefill?: Partial<Omit<ExpenseDraft, 'id'>>;
  /** Fields to outline in amber, with the reason — a scanned value to check. */
  flags?: Record<string, string>;
  /** Extra values sent with the form. */
  hidden?: Record<string, string>;
  /** Saves a new expense in place of the usual action (Scan bill attaches the file too). */
  submit?: (prev: ActionResult, formData: FormData) => Promise<ActionResult>;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [state, onSubmit, isPending] = useFormAction<ActionResult>(
    async (prev, formData) => {
      const result = expense
        ? await updateExpenseAction(expense.id, prev, formData)
        : submit
          ? await submit(prev, formData)
          : await recordExpenseAction(prev, formData);
      if (result.ok) {
        toast.success(expense ? 'Expense updated' : 'Expense recorded');
        router.refresh();
        onDone?.();
      }
      return result;
    },
    { ok: false },
  );
  const errors = state.fieldErrors ?? {};
  // Unique ids, so an edit dialog can sit on the same page as the record form.
  const id = (name: string) =>
    expense ? name + '-' + expense.id : prefill ? name + '-scan' : name;
  /** What the form opens on: the expense being corrected, or a scanned bill's values. */
  const start = expense ?? prefill;
  const amber = (name: string) => (flags[name] ? ` ${AMBER}` : '');

  // Amount, VAT and total, kept in step: the VAT follows the amount and the
  // tax code until a figure is typed from the bill, which then stands.
  const [amount, setAmount] = useState(start?.amount ?? '');
  const [codeId, setCodeId] = useState(
    taxCodes.length ? prefill?.taxCodeId || startingCode(taxCodes, expense) : '',
  );
  const [typedRate, setTypedRate] = useState(
    expense ? expense.taxRate : defaultVatRate.replace(/\.?0+$/, ''),
  );
  const rate = taxCodes.length ? rateOfCode(taxCodes, codeId) : typedRate;
  const calculated = vatOn(amount, rate);
  const [ownVat, setOwnVat] = useState<string | null>(() => {
    // A figure from the bill (or saved earlier) that differs from the rate's stays as it is.
    const given = start?.taxAmount;
    if (!given || !MONEY.test(given)) return null;
    return vatOn(start?.amount ?? '', rate) === filsToString(toFils(given)) ? null : given;
  });
  const [totalText, setTotalText] = useState<string | null>(null);
  // Paid from an account (ask for its reference), by an owner, or not yet (ask when it's due).
  const [payer, setPayer] = useState<'paid' | 'personal' | 'unpaid'>(
    start?.paidByUserId ? 'personal' : expense?.paymentMethod ? 'paid' : 'unpaid',
  );
  const [referenceNeeded, setReferenceNeeded] = useState(false);
  const vat = ownVat ?? calculated;
  const total =
    MONEY.test(amount.trim()) && MONEY.test(vat.trim())
      ? filsToString(toFils(amount.trim()) + toFils(vat.trim()))
      : '';

  function onTotal(value: string) {
    setTotalText(value);
    if (MONEY.test(amount.trim()) && MONEY.test(value.trim())) {
      const difference = toFils(value.trim()) - toFils(amount.trim());
      if (difference >= 0) setOwnVat(filsToString(difference));
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <TextField
        label="What was it for?"
        id={id('description')}
        name="description"
        required
        defaultValue={start?.description}
        placeholder="e.g. Monthly workshop rent — October"
        error={errors.description}
        className={INPUT}
      />

      <div className="grid gap-6 sm:grid-cols-2">
        <Field label="Category" htmlFor={id('categoryId')} error={errors.categoryId}>
          <NativeSelect
            id={id('categoryId')}
            name="categoryId"
            defaultValue={start?.categoryId ?? ''}
            className="h-11 text-base md:text-sm"
          >
            <option value="">Uncategorised</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.accountName}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <TextField
          label="Date"
          id={id('expenseDate')}
          name="expenseDate"
          type="date"
          required
          defaultValue={start?.expenseDate ?? today()}
          error={errors.expenseDate}
          hint={flags.expenseDate}
          className={INPUT + amber('expenseDate')}
        />
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <TextField
          label="Amount excluding VAT"
          id={id('amount')}
          name="amount"
          inputMode="decimal"
          required
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          placeholder="0.00"
          error={errors.amount}
          hint={flags.amount ?? 'In AED.'}
          className={`${INPUT} [&_input]:text-right [&_input]:tabular-nums${amber('amount')}`}
        />
        {taxCodes.length ? (
          <Field
            label="Tax code"
            htmlFor={id('taxCodeId')}
            error={errors.taxCodeId}
            hint="The VAT on the supplier's bill. Exempt or out of scope: nothing to reclaim."
          >
            <NativeSelect
              id={id('taxCodeId')}
              name="taxCodeId"
              value={codeId}
              onChange={(event) => {
                setCodeId(event.target.value);
                // A new code: the VAT follows it again, unless it carries none.
                setOwnVat(null);
              }}
              className="h-11 text-base md:text-sm"
            >
              {taxCodes.map((code) => (
                <option key={code.id} value={code.id}>
                  {code.code} — {code.name}
                  {code.treatment === 'STANDARD' ? ` (${code.rate.replace(/\.?0+$/, '')}%)` : ''}
                </option>
              ))}
            </NativeSelect>
          </Field>
        ) : (
          <TextField
            label="VAT rate"
            id={id('taxRate')}
            name="taxRate"
            inputMode="decimal"
            value={typedRate}
            onChange={(event) => {
              setTypedRate(event.target.value);
              setOwnVat(null);
            }}
            error={errors.taxRate}
            hint="Leave empty if the expense carries no VAT."
            className={`${INPUT} [&_input]:text-right [&_input]:tabular-nums`}
          />
        )}
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <TextField
          label="VAT amount"
          id={id('taxAmount')}
          name="taxAmount"
          inputMode="decimal"
          value={vat}
          onChange={(event) => {
            setOwnVat(event.target.value);
            setTotalText(null);
          }}
          disabled={!rate}
          error={errors.taxAmount}
          hint={
            !rate ? (
              'No VAT to reclaim on this tax code.'
            ) : ownVat !== null && calculated && ownVat !== calculated ? (
              <span>
                {`As on the bill. Calculated: ${formatMoney(calculated)}. `}
                <button
                  type="button"
                  className="font-medium text-primary hover:underline"
                  onClick={() => {
                    setOwnVat(null);
                    setTotalText(null);
                  }}
                >
                  Use calculated
                </button>
              </span>
            ) : (
              'Worked out from the amount. Type the bill’s own figure if it differs.'
            )
          }
          className={`${INPUT} [&_input]:text-right [&_input]:tabular-nums${
            ownVat !== null && calculated && ownVat !== calculated ? ` ${AMBER}` : ''
          }`}
        />
        <TextField
          label="Total paid"
          name="totalPaid"
          id={id('total')}
          inputMode="decimal"
          value={totalText ?? total}
          onChange={(event) => onTotal(event.target.value)}
          onBlur={() => setTotalText(null)}
          disabled={!rate}
          hint={
            rate
              ? 'Amount plus VAT. Type the bill’s total and the VAT is worked back from it.'
              : 'The same as the amount: no VAT.'
          }
          className={`${INPUT} [&_input]:text-right [&_input]:tabular-nums [&_input]:font-semibold`}
        />
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <TextField
          label="Supplier (paid to)"
          id={id('vendorName')}
          name="vendorName"
          defaultValue={start?.vendorName}
          placeholder="e.g. the landlord or utility company"
          error={errors.vendorName}
          className={INPUT}
        />
        <TextField
          label="Supplier TRN"
          id={id('supplierTrn')}
          name="supplierTrn"
          inputMode="numeric"
          defaultValue={start?.supplierTrn}
          error={errors.supplierTrn}
          hint={
            rate
              ? 'From their tax invoice. Needed to reclaim the VAT.'
              : 'Optional. From their invoice, if it shows one.'
          }
          className={`${INPUT} [&_input]:font-mono`}
        />
      </div>
      <div className="grid gap-6 sm:grid-cols-2">
        <TextField
          label="Bill number"
          id={id('billNumber')}
          name="billNumber"
          defaultValue={start?.billNumber}
          placeholder="The supplier’s invoice or receipt number"
          error={errors.billNumber}
          hint="Lets the same bill be spotted if it is entered twice."
          className={INPUT}
        />
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        {modes.length ? (
          <PaymentModeField
            id={id('paymentMode')}
            modes={modes}
            label="Paid by"
            methodName="paymentMethod"
            accountName="paidFromAccountId"
            unsettledLabel="Not settled yet — owed to the supplier"
            defaultModeId={
              expense ? modeFor(modes, expense.paymentMethod, expense.paidFromAccountId) : undefined
            }
            people={people}
            defaultPersonId={start?.paidByUserId || undefined}
            error={errors.paymentMethod ?? errors.paidFromAccountId ?? errors.paidByUserId}
            onKindChange={setPayer}
            onChange={(mode) => setReferenceNeeded(Boolean(mode?.requiresReference))}
            className="h-11 text-base md:text-sm"
          />
        ) : (
          <Field
            label="Paid by"
            htmlFor={id('paymentMethod')}
            error={errors.paymentMethod}
            hint="Leave empty if it has not been paid yet."
          >
            <NativeSelect
              id={id('paymentMethod')}
              name="paymentMethod"
              defaultValue={expense?.paymentMethod ?? ''}
              onChange={(event) => setPayer(event.target.value ? 'paid' : 'unpaid')}
              className="h-11 text-base md:text-sm"
            >
              <option value="">Not settled yet</option>
              <option value="CASH">Cash</option>
              <option value="CARD">Card</option>
              <option value="BANK_TRANSFER">Bank transfer</option>
              <option value="CHEQUE">Cheque</option>
              <option value="ONLINE">Online</option>
            </NativeSelect>
          </Field>
        )}
        {payer === 'paid' ? (
          <TextField
            label="Payment reference"
            id={id('paymentReference')}
            name="paymentReference"
            defaultValue={start?.paymentReference}
            error={errors.paymentReference}
            hint={
              referenceNeeded
                ? 'Needed for this payment mode: the transfer, cheque or card-slip number.'
                : 'The transfer, cheque or card-slip number, if there is one.'
            }
            className={INPUT}
          />
        ) : payer === 'unpaid' ? (
          <TextField
            label="Due date"
            id={id('dueDate')}
            name="dueDate"
            type="date"
            defaultValue={start?.dueDate}
            error={errors.dueDate}
            hint="When the supplier expects to be paid."
            className={INPUT}
          />
        ) : null}
      </div>
      {moneyAccounts.length && !modes.length ? (
        <div className="grid gap-6 sm:grid-cols-2">
          <MoneyAccountField
            id={id('paidFromAccountId')}
            name="paidFromAccountId"
            label="Paid from"
            accounts={moneyAccounts}
            defaultValue={expense?.paidFromAccountId ?? ''}
            error={errors.paidFromAccountId}
            className="h-11 text-base md:text-sm"
          />
        </div>
      ) : null}

      <TextareaField
        label="Notes"
        id={id('notes')}
        name="notes"
        defaultValue={start?.notes}
        error={errors.notes}
        placeholder="Anything worth keeping with it — what it covered, who approved it."
        className="[&_textarea]:min-h-16"
      />

      <FormError message={Object.keys(errors).length ? undefined : state.error} />
      <div className="border-t border-border pt-4">
        <SubmitButton
          pending={isPending}
          size="lg"
          className="h-11"
          pendingLabel={expense ? 'Saving…' : 'Recording…'}
        >
          {expense ? <Save /> : <Plus />}
          {expense ? 'Save changes' : 'Record expense'}
        </SubmitButton>
      </div>
    </form>
  );
}
