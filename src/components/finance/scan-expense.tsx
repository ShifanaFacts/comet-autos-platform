'use client';

import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/layout/primitives';
import {
  attachScannedBill,
  BillNotices,
  BillPreview,
  ScanBillButton,
  useBillScan,
} from '@/components/bill-reader/scan-bill';
import { ExpenseForm, type ExpenseDraft } from '@/components/finance/expense-form';
import { recordScannedExpenseAction } from '@/app/(app)/finance/actions';
import type { AccountChoice } from '@/lib/accounting/reports';
import type { TaxCodeOption } from '@/lib/accounting/tax-codes';
import type { PaymentModeOption } from '@/lib/accounting/payment-modes';
import type { BillDraft } from '@/lib/bill-reader/read';
import type { ActionResult } from '@/lib/errors';

/** The tax code a scanned bill opens on: the standard code at its rate, or one that claims no VAT. */
function codeFor(codes: TaxCodeOption[], draft: BillDraft): string {
  const noVat =
    codes.find((code) => code.treatment === 'OUT_OF_SCOPE') ??
    codes.find((code) => Number(code.rate) === 0);
  const vat = Number(draft.vat ?? 0);
  const subtotal = Number(draft.subtotal ?? 0);
  if (!draft.isTaxInvoice || vat <= 0 || subtotal <= 0) return noVat?.id ?? '';
  const rate = Math.round((vat / subtotal) * 100);
  return (
    codes.find((code) => code.treatment === 'STANDARD' && Math.round(Number(code.rate)) === rate)
      ?.id ?? ''
  );
}

/** The expense form's starting values from what the reader found; the rest stays empty. */
function toPrefill(draft: BillDraft, codes: TaxCodeOption[]) {
  const flags: Record<string, string> = {};
  const prefill: Partial<Omit<ExpenseDraft, 'id'>> = {
    vendorName: draft.supplier?.name ?? draft.supplierName ?? '',
    billNumber: draft.billNumber ?? '',
    taxCodeId: codeFor(codes, draft),
  };
  if (draft.billDate) prefill.expenseDate = draft.billDate;

  const reason = draft.warnings[0]?.message;
  if (!draft.isTaxInvoice) {
    // No VAT to reclaim: the whole amount paid is the expense.
    prefill.amount = draft.total ?? draft.subtotal ?? '';
    if (reason) flags.amount = reason;
  } else if (draft.subtotal) {
    prefill.amount = draft.subtotal;
    if (reason) flags.amount = reason;
  } else if (draft.total) {
    flags.amount = `Only the total (${draft.total}) could be read. Enter the amount before VAT.`;
  }
  return { prefill, flags };
}

/**
 * "Scan bill" on Expenses & bills: reads a photo or PDF of the supplier's
 * bill and opens the usual expense form on what it found, with the bill
 * beside it. Saving records the expense and keeps the file with it.
 */
export function ScanExpense({
  categories,
  defaultVatRate,
  moneyAccounts,
  taxCodes,
  modes,
}: {
  categories: { id: string; accountCode: string; accountName: string }[];
  defaultVatRate: string;
  moneyAccounts: AccountChoice[];
  taxCodes: TaxCodeOption[];
  modes: PaymentModeOption[];
}) {
  const router = useRouter();
  const { phase, scan, reset } = useBillScan('expense');

  if (phase.name !== 'ready') {
    return <ScanBillButton phase={phase} onFile={scan} />;
  }

  const { draft, file, previewUrl } = phase;
  const { prefill, flags } = toPrefill(draft, taxCodes);

  async function save(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
    const result = await recordScannedExpenseAction({ ok: false }, formData);
    if (result.ok && result.data?.id) {
      const problem = await attachScannedBill(`/finance/expenses/${result.data.id}/bill`, file);
      if (problem) toast.warning(`Expense recorded, but the bill wasn’t attached: ${problem}`);
      router.refresh();
    }
    return { ok: result.ok, error: result.error, fieldErrors: result.fieldErrors };
  }

  return (
    <Panel className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-semibold">Scanned bill — check, then record</p>
          <p className="text-sm text-muted-foreground">
            Filled from the bill where it could be read. Empty fields weren’t found. Nothing is
            saved until you press Record expense.
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={reset}>
          <X />
          Discard
        </Button>
      </div>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <BillNotices draft={draft} />
          <ExpenseForm
            key={previewUrl}
            categories={categories}
            defaultVatRate={defaultVatRate}
            moneyAccounts={moneyAccounts}
            taxCodes={taxCodes}
            modes={modes}
            prefill={prefill}
            flags={flags}
            hidden={{ scannedFields: draft.filled.join(',') || 'none' }}
            submit={save}
            onDone={reset}
          />
        </div>
        <BillPreview file={file} previewUrl={previewUrl} />
      </div>
    </Panel>
  );
}
