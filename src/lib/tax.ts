/**
 * VAT configuration — the single place the default rate is defined.
 *
 * Today every organization uses the UAE standard rate. When an
 * organization-level VAT setting is added (e.g. a column on Organization or
 * a settings table), only resolveDefaultVatRate() changes: calculations in
 * lib/money.ts take the rate as an input and never assume one, estimate
 * lines store the rate they were priced at, and the estimate builder
 * receives the default from the server.
 *
 * This is deliberately not a tax engine: no exemptions, zero-rating,
 * reverse charge or per-item tax categories yet.
 */

/** UAE standard VAT rate, as a percentage string with two decimals. */
export const UAE_STANDARD_VAT_RATE = '5.00';

/** The VAT rate new estimate lines default to for this organization. */
export function resolveDefaultVatRate(organizationId: string): string {
  void organizationId; // Per-organization configuration isn't modelled yet.
  return UAE_STANDARD_VAT_RATE;
}
