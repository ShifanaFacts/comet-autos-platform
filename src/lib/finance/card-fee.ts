import { DomainError } from '@/lib/errors';
import { emptyToNull } from '@/lib/normalize';
import { calculateLine, filsToString, toFils } from '@/lib/money';

/**
 * The bank's fee on card money, its VAT, and what is left to hand over. A
 * typed figure (from the bank statement) stands; otherwise the fee is the
 * rate on the amount, and the VAT the VAT rate on the fee — rounded the same
 * way as any invoice line.
 */
export function splitCardFee(
  collected: string,
  input: { feeRate?: string; feeAmount?: string; feeVatAmount?: string },
  vatRate: string,
) {
  const collectedFils = toFils(collected);
  const rate = emptyToNull(input.feeRate);
  const fee = emptyToNull(input.feeAmount)
    ? toFils(input.feeAmount!)
    : rate
      ? calculateLine({ quantity: '1', unitPrice: collected, taxRate: rate }).taxFils
      : 0;
  const vat = emptyToNull(input.feeVatAmount)
    ? toFils(input.feeVatAmount!)
    : fee > 0 && Number(vatRate) > 0
      ? calculateLine({ quantity: '1', unitPrice: filsToString(fee), taxRate: vatRate }).taxFils
      : 0;
  if (vat > 0 && fee === 0) {
    throw new DomainError('Enter the bank’s fee the VAT is charged on.', 'feeAmount');
  }
  if (vat > fee) {
    throw new DomainError('The VAT can’t be more than the fee it is on.', 'feeVatAmount');
  }
  if (fee + vat >= collectedFils) {
    throw new DomainError('The bank’s fee can’t be the whole amount collected.', 'feeAmount');
  }
  return { rate, fee, vat, paid: collectedFils - fee - vat };
}
