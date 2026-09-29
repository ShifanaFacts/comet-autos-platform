import { toFils } from '@/lib/money';

/*
 * Straight-line depreciation, month by month — plain arithmetic, shared by
 * the fixed asset register (lib/accounting/fixed-assets.ts) and its tests.
 */

/** Whole months since year 0: comparable and easy to step. */
export const monthIndex = (date: Date) => date.getUTCFullYear() * 12 + date.getUTCMonth();
/** The last day of a month index, as a calendar date. */
export const monthEnd = (index: number) =>
  new Date(Date.UTC(Math.floor(index / 12), (index % 12) + 1, 0));
export const monthLabel = (index: number) =>
  `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;

/** Half-up rounding of base × part ÷ whole, exact for any size. */
const cumulative = (base: number, part: number, whole: number) =>
  Number((BigInt(base) * BigInt(part) * BigInt(2) + BigInt(whole)) / (BigInt(whole) * BigInt(2)));

export interface ScheduleInput {
  acquiredOn: Date;
  cost: { toString(): string };
  residualValue: { toString(): string };
  usefulLifeMonths: number;
  funding: string;
  openingDepreciation: { toString(): string };
  openingThrough: Date | null;
}

/** When depreciation runs and what each month charges. */
export function depreciationPlan(asset: ScheduleInput) {
  const opening = asset.funding === 'OPENING' && asset.openingThrough;
  const startMonth =
    (opening ? monthIndex(asset.openingThrough!) : monthIndex(asset.acquiredOn)) + 1;
  const used = opening
    ? Math.max(0, monthIndex(asset.openingThrough!) - monthIndex(asset.acquiredOn))
    : 0;
  const months = Math.max(asset.usefulLifeMonths - used, 0);
  const base = Math.max(
    toFils(asset.cost.toString()) -
      toFils(asset.residualValue.toString()) -
      toFils(asset.openingDepreciation.toString()),
    0,
  );
  /** The charge for the n-th month of the remaining life (1-based). */
  const charge = (n: number) =>
    months === 0 ? 0 : cumulative(base, n, months) - cumulative(base, n - 1, months);
  return { startMonth, months, base, charge };
}
