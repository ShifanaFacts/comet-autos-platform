'use client';

import { useRouter } from 'next/navigation';
import { ExpenseForm, type ExpenseDraft } from '@/components/finance/expense-form';
import type { AccountChoice } from '@/lib/accounting/reports';
import type { TaxCodeOption } from '@/lib/accounting/tax-codes';
import type { JobChoice } from '@/lib/finance/job-costing';
import type { PaymentModeOption } from '@/lib/accounting/payment-modes';

/** The expense form on its own page: saving goes back to the expense. */
export function EditExpenseForm(props: {
  expense: ExpenseDraft;
  categories: { id: string; accountCode: string; accountName: string }[];
  defaultVatRate: string;
  moneyAccounts?: AccountChoice[];
  taxCodes?: TaxCodeOption[];
  modes?: PaymentModeOption[];
  people?: { id: string; name: string }[];
  jobs?: JobChoice[];
}) {
  const router = useRouter();
  return (
    <ExpenseForm {...props} onDone={() => router.push(`/finance/expenses/${props.expense.id}`)} />
  );
}
