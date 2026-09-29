'use client';

import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { ExpenseForm, type ExpenseDraft } from '@/components/finance/expense-form';
import type { AccountChoice } from '@/lib/accounting/reports';
import type { TaxCodeOption } from '@/lib/accounting/tax-codes';
import type { PaymentModeOption } from '@/lib/accounting/payment-modes';

/** Corrects a recorded expense in a dialog; the change is kept in the audit log. */
export function EditExpenseButton({
  expense,
  categories,
  defaultVatRate,
  moneyAccounts,
  taxCodes,
  modes,
}: {
  expense: ExpenseDraft;
  categories: { id: string; accountCode: string; accountName: string }[];
  defaultVatRate: string;
  moneyAccounts?: AccountChoice[];
  taxCodes?: TaxCodeOption[];
  modes?: PaymentModeOption[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="ghost" size="sm" aria-label={`Edit ${expense.description}`}>
            <Pencil />
            Edit
          </Button>
        }
      />
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit expense</DialogTitle>
          <DialogDescription>
            Correct what was recorded. The original is kept in the history.
          </DialogDescription>
        </DialogHeader>
        <ExpenseForm
          categories={categories}
          defaultVatRate={defaultVatRate}
          moneyAccounts={moneyAccounts}
          taxCodes={taxCodes}
          modes={modes}
          expense={expense}
          onDone={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
