import type { VatTreatment } from '@/generated/prisma/enums';
import { toFils } from '@/lib/money';
import { treatmentFromRate } from '@/lib/vat-treatment';

/*
 * How a document's taxable amount divides between the VAT201 boxes — plain
 * arithmetic, shared by the VAT return (lib/finance/vat.ts) and its tests.
 */

const fils = (value: { toString(): string } | null | undefined) =>
  value ? toFils(value.toString()) : 0;

export type SupplySplit = Record<VatTreatment, number>;

const TREATMENT_ORDER: VatTreatment[] = ['STANDARD', 'ZERO_RATED', 'EXEMPT', 'OUT_OF_SCOPE'];

/**
 * Splits a document's subtotal (after any bill discount) by VAT treatment,
 * in fils, in proportion to its lines. Largest remainder, so the parts always
 * add up to the subtotal exactly.
 */
export function splitByTreatment(
  subtotalFils: number,
  lines: { lineTotal: { toString(): string }; vatTreatment: VatTreatment }[],
): SupplySplit {
  const split: SupplySplit = { STANDARD: 0, ZERO_RATED: 0, EXEMPT: 0, OUT_OF_SCOPE: 0 };
  const byTreatment = { ...split };
  for (const line of lines) byTreatment[line.vatTreatment] += fils(line.lineTotal);
  const linesFils = TREATMENT_ORDER.reduce((sum, t) => sum + byTreatment[t], 0);
  if (linesFils <= 0) {
    split.STANDARD = subtotalFils;
    return split;
  }
  let given = 0;
  const remainders: { treatment: VatTreatment; rest: bigint }[] = [];
  for (const treatment of TREATMENT_ORDER) {
    const exact = BigInt(subtotalFils) * BigInt(byTreatment[treatment]);
    split[treatment] = Number(exact / BigInt(linesFils));
    given += split[treatment];
    remainders.push({ treatment, rest: exact % BigInt(linesFils) });
  }
  remainders.sort((x, y) => (y.rest > x.rest ? 1 : y.rest < x.rest ? -1 : 0));
  for (let i = 0; given < subtotalFils; i += 1, given += 1) {
    split[remainders[i % remainders.length].treatment] += 1;
  }
  return split;
}

/**
 * Splits an invoice's subtotal into its standard-rated and zero-rated parts,
 * in fils, from the lines' rates alone (0% or none is zero-rated).
 */
export function splitSupplies(
  subtotalFils: number,
  lines: { lineTotal: { toString(): string }; taxRate: { toString(): string } | null }[],
) {
  const split = splitByTreatment(
    subtotalFils,
    lines.map((line) => ({
      lineTotal: line.lineTotal,
      vatTreatment: treatmentFromRate(line.taxRate),
    })),
  );
  return { standard: split.STANDARD, zero: split.ZERO_RATED };
}
