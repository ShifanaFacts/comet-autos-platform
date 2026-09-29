import type { Emirate, VatTreatment } from '@/generated/prisma/enums';

/*
 * How a line is treated for UAE VAT (Federal Decree-Law No. 8 of 2017), and
 * the rate that follows from it. Nobody types a VAT rate on a line: a
 * standard-rated line is charged at the workshop's own rate (Settings, 5%),
 * everything else at nothing.
 *
 *   STANDARD      taxable at the standard rate            VAT201 Box 1
 *   ZERO_RATED    taxable at 0% (exports, some transport)  Box 4
 *   EXEMPT        not taxable (rare for a workshop)        Box 5
 *   OUT_OF_SCOPE  not a supply for VAT (e.g. a traffic fine passed on
 *                 at cost as a disbursement)               not reported
 *
 * Plain data, used on screen and on the server alike.
 */

export type { Emirate, VatTreatment };

export const VAT_TREATMENTS: { value: VatTreatment; label: string; short: string }[] = [
  { value: 'STANDARD', label: 'Standard-rated', short: 'Standard' },
  { value: 'ZERO_RATED', label: 'Zero-rated (0%)', short: 'Zero-rated' },
  { value: 'EXEMPT', label: 'Exempt', short: 'Exempt' },
  { value: 'OUT_OF_SCOPE', label: 'Out of scope', short: 'Out of scope' },
];

export const VAT_TREATMENT_LABEL = Object.fromEntries(
  VAT_TREATMENTS.map((treatment) => [treatment.value, treatment.label]),
) as Record<VatTreatment, string>;

/** Box 1's line for each emirate on the VAT201. */
export const EMIRATE_BOX: Record<Emirate, { box: string; name: string }> = {
  ABU_DHABI: { box: '1a', name: 'Abu Dhabi' },
  DUBAI: { box: '1b', name: 'Dubai' },
  SHARJAH: { box: '1c', name: 'Sharjah' },
  AJMAN: { box: '1d', name: 'Ajman' },
  UMM_AL_QUWAIN: { box: '1e', name: 'Umm Al Quwain' },
  RAS_AL_KHAIMAH: { box: '1f', name: 'Ras Al Khaimah' },
  FUJAIRAH: { box: '1g', name: 'Fujairah' },
};

/**
 * Where the workshop makes its supplies — its standard-rated sales are
 * reported against this emirate's line of Box 1.
 */
export const EMIRATES = Object.entries(EMIRATE_BOX).map(([value, { box, name }]) => ({
  value: value as Emirate,
  label: `${name} (Box ${box})`,
}));

/** The rate a line is charged at: the workshop's standard rate, or nothing. */
export function rateFor(treatment: VatTreatment, standardRate: string): string {
  return treatment === 'STANDARD' ? standardRate : '0.00';
}

/**
 * For lines written before treatments existed (and imports that give only a
 * rate): 0% (or no rate) was always reported as zero-rated, anything else as
 * standard.
 */
export function treatmentFromRate(rate: { toString(): string } | null | undefined): VatTreatment {
  return !rate || Number(rate.toString()) === 0
    ? 'ZERO_RATED'
    : 'STANDARD';
}
