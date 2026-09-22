import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';

/**
 * VAT configuration — the single place a default rate comes from.
 *
 * Each organization carries its own settings (Organization.isVatRegistered,
 * vatRate, taxNumber). Every existing organization was migrated to
 * registered-at-5.00%, which is what they were all charged before, so no
 * behaviour changed on deploy.
 *
 * The rate here is only ever a DEFAULT: calculations in lib/money.ts take
 * the rate as an input and never assume one, and estimate, invoice and
 * purchase lines store the rate they were priced at. Changing an
 * organization's rate therefore changes new lines only — issued documents
 * keep their figures.
 *
 * This is deliberately not a tax engine: no exemptions, zero-rating, reverse
 * charge or per-item tax categories yet.
 */

/** Used only if an organization row somehow carries no rate. Never read elsewhere. */
export const FALLBACK_VAT_RATE = '5.00';

/** @deprecated Kept for existing imports; the rate now comes from the organization. */
export const UAE_STANDARD_VAT_RATE = FALLBACK_VAT_RATE;

export interface VatSettings {
  isVatRegistered: boolean;
  /** Percentage with two decimals, e.g. "5.00". */
  vatRate: string;
  /** The organization's TRN, shown on tax documents. */
  taxNumber: string | null;
}

/** The organization's VAT settings. Pass a transaction client to read inside one. */
export async function getVatSettings(
  organizationId: string,
  client: Prisma.TransactionClient = prisma,
): Promise<VatSettings> {
  const organization = await client.organization.findUnique({
    where: { id: organizationId },
    select: { isVatRegistered: true, vatRate: true, taxNumber: true },
  });
  return {
    isVatRegistered: organization?.isVatRegistered ?? true,
    vatRate: organization ? organization.vatRate.toFixed(2) : FALLBACK_VAT_RATE,
    taxNumber: organization?.taxNumber ?? null,
  };
}

/**
 * The VAT rate new lines default to for this organization: its configured
 * rate if it is VAT-registered, otherwise zero.
 */
export async function resolveDefaultVatRate(
  organizationId: string,
  client: Prisma.TransactionClient = prisma,
): Promise<string> {
  const settings = await getVatSettings(organizationId, client);
  return settings.isVatRegistered ? settings.vatRate : '0.00';
}
