'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import type { PaymentMethod } from '@/generated/prisma/enums';
import { Button } from '@/components/ui/button';
import { ConfirmAction } from '@/components/shared/confirm-action';
import { Panel } from '@/components/layout/primitives';
import { StatusPill } from '@/components/shared/status-pill';
import { formatDateTime, formatMoney } from '@/lib/format';
import { reverseSupplierPaymentAction } from '@/app/(app)/finance/payables/actions';

const METHOD_LABEL: Record<PaymentMethod, string> = {
  CASH: 'Cash',
  CARD: 'Card',
  BANK_TRANSFER: 'Bank transfer',
  CHEQUE: 'Cheque',
  ONLINE: 'Online',
};

export interface PaymentHistoryRow {
  id: string;
  supplierPaymentNumber: string | null;
  amount: string;
  method: PaymentMethod;
  status: string;
  referenceNumber: string | null;
  paidAt: Date;
  isReversal: boolean;
  wasReversed: boolean;
  paidBy: { fullName: string } | null;
  purchase: { id: string; purchaseNumber: string; supplier: { id: string; name: string } };
}

/*
 * What has been paid, and what happened to it.
 *
 * Nothing is ever removed from this list. A payment made in error is
 * reversed: the original stays, marked Reversed, and the reversal that
 * cancelled it sits alongside — both drop out of the balance, and the
 * history still explains why the money came back.
 */
export function SupplierPaymentHistory({
  payments,
  canReverse,
  showSupplier,
}: {
  payments: PaymentHistoryRow[];
  canReverse: boolean;
  showSupplier?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function reverse(payment: PaymentHistoryRow) {
    startTransition(async () => {
      const result = await reverseSupplierPaymentAction(
        payment.id,
        'Reversed from the payables screen',
      );
      if (!result.ok) {
        toast.error(result.error ?? 'That payment could not be reversed.');
        return;
      }
      toast.success(`${formatMoney(payment.amount)} is owed again`);
      router.refresh();
    });
  }

  if (payments.length === 0) {
    return (
      <Panel>
        <p className="text-sm text-muted-foreground">No payments recorded yet.</p>
      </Panel>
    );
  }

  return (
    <Panel padding="none" className="overflow-hidden">
      <ul className="divide-y divide-border">
        {payments.map((payment) => (
          <li key={payment.id} className="flex flex-col gap-2 px-4 py-4 sm:px-6">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-2">
                  {showSupplier ? (
                    <span className="truncate font-medium">{payment.purchase.supplier.name}</span>
                  ) : (
                    <span className="font-mono text-xs text-muted-foreground">
                      {payment.supplierPaymentNumber ?? '—'}
                    </span>
                  )}
                  {payment.isReversal ? (
                    <StatusPill tone="neutral">Reversal</StatusPill>
                  ) : payment.wasReversed ? (
                    <StatusPill tone="danger">Reversed</StatusPill>
                  ) : null}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  <span className="font-mono">{payment.purchase.purchaseNumber}</span> ·{' '}
                  {METHOD_LABEL[payment.method]}
                  {payment.referenceNumber && !payment.isReversal
                    ? ` · ${payment.referenceNumber}`
                    : ''}
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatDateTime(payment.paidAt)}
                  {payment.paidBy ? ` · ${payment.paidBy.fullName}` : ''}
                </span>
              </div>
              <span
                className={`shrink-0 text-right font-semibold tabular-nums ${
                  payment.isReversal || payment.wasReversed
                    ? 'text-muted-foreground line-through'
                    : ''
                }`}
              >
                {payment.isReversal ? '−' : ''}
                {formatMoney(payment.amount)}
              </span>
            </div>

            {canReverse && !payment.isReversal && !payment.wasReversed ? (
              <div className="flex justify-end">
                <ConfirmAction
                  trigger={
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-11 text-muted-foreground hover:text-danger sm:h-9"
                      disabled={isPending}
                    >
                      <Undo2 />
                      Reverse
                    </Button>
                  }
                  title={`Reverse ${formatMoney(payment.amount)}?`}
                  description={`${formatMoney(payment.amount)} will be owed again on ${payment.purchase.purchaseNumber}. Nothing is deleted — the payment stays on record, marked reversed, with your name against the reversal.`}
                  confirmLabel="Reverse payment"
                  onConfirm={async () => reverse(payment)}
                />
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
