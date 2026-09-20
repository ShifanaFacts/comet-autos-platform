import type { CustomerAccessResourceType } from '@/generated/prisma/enums';
import { prisma } from '@/lib/prisma';
import { compactPlate, phoneCore } from '@/lib/normalize';
import {
  computeAccessProof,
  proofMatches,
  resolveAccessToken,
  type TokenState,
} from '@/lib/customer-access/tokens';

/*
 * The customer-link check shared by every customer page (quotation,
 * invoice): the link must resolve to a live token of the expected kind, and
 * the browser must hold the proof it earned by typing the vehicle
 * registration and mobile number on file. Nothing here takes an internal id
 * from the browser — only the raw token from the URL.
 */

export interface OrganizationBranding {
  name: string;
  legalName: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  taxNumber: string | null;
}

export type CustomerAccess =
  | { state: 'invalid' }
  | { state: 'expired'; organization: OrganizationBranding }
  | { state: 'needs_verification'; tokenHash: string; organization: OrganizationBranding }
  | {
      state: 'verified';
      tokenHash: string;
      organization: OrganizationBranding;
      organizationId: string;
      resourceId: string;
    };

export async function loadBranding(organizationId: string): Promise<OrganizationBranding> {
  return prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: {
      name: true,
      legalName: true,
      address: true,
      phone: true,
      email: true,
      taxNumber: true,
    },
  });
}

/** The registration and mobile number a customer must know to open the resource. */
async function loadOwner(
  type: CustomerAccessResourceType,
  organizationId: string,
  resourceId: string,
) {
  const vehicleSelect = {
    vehicle: { select: { plateNumber: true, customer: { select: { phone: true } } } },
  } as const;
  const jobCard =
    type === 'ESTIMATE'
      ? (
          await prisma.estimate.findFirst({
            where: { id: resourceId, organizationId },
            select: { jobCard: { select: vehicleSelect } },
          })
        )?.jobCard
      : (
          await prisma.invoice.findFirst({
            where: { id: resourceId, organizationId },
            select: { jobCard: { select: vehicleSelect } },
          })
        )?.jobCard;
  if (!jobCard) return null;
  return { plateNumber: jobCard.vehicle.plateNumber, phone: jobCard.vehicle.customer.phone };
}

/** Resolves the link and checks the browser's verification proof (cookie value). */
export async function getCustomerAccess(
  rawToken: string,
  type: CustomerAccessResourceType,
  proof: string | undefined,
): Promise<CustomerAccess> {
  const resolved = await resolveAccessToken(rawToken, type);
  if (resolved.state === 'invalid' || !resolved.token) return { state: 'invalid' };
  const organization = await loadBranding(resolved.token.organizationId);
  if (resolved.state === 'expired') return { state: 'expired', organization };

  const owner = await loadOwner(type, resolved.token.organizationId, resolved.token.resourceId);
  if (!owner) return { state: 'invalid' };
  const expected = computeAccessProof(resolved.token.tokenHash, owner.plateNumber, owner.phone);
  return proofMatches(expected, proof)
    ? {
        state: 'verified',
        tokenHash: resolved.token.tokenHash,
        organization,
        organizationId: resolved.token.organizationId,
        resourceId: resolved.token.resourceId,
      }
    : { state: 'needs_verification', tokenHash: resolved.token.tokenHash, organization };
}

/**
 * Checks the registration + mobile number the customer typed against the
 * vehicle and owner behind the link. The same generic answer is returned for
 * every mismatch so the form can't be used to probe which part was wrong.
 */
export async function verifyCustomerAccess(
  rawToken: string,
  type: CustomerAccessResourceType,
  plateNumber: string,
  phone: string,
): Promise<
  { ok: true; proof: string; tokenHash: string } | { ok: false; state: TokenState | 'mismatch' }
> {
  const resolved = await resolveAccessToken(rawToken, type);
  if (resolved.state !== 'valid' || !resolved.token) return { ok: false, state: resolved.state };

  const owner = await loadOwner(type, resolved.token.organizationId, resolved.token.resourceId);
  const plateOk =
    owner !== null &&
    compactPlate(plateNumber).length > 0 &&
    compactPlate(plateNumber) === compactPlate(owner.plateNumber);
  const phoneOk =
    owner !== null && phoneCore(phone).length >= 7 && phoneCore(phone) === phoneCore(owner.phone);
  if (!owner || !plateOk || !phoneOk) return { ok: false, state: 'mismatch' };

  await prisma.customerAccessToken.update({
    where: { id: resolved.token.id },
    data: { lastAccessedAt: new Date() },
  });
  return {
    ok: true,
    proof: computeAccessProof(resolved.token.tokenHash, owner.plateNumber, owner.phone),
    tokenHash: resolved.token.tokenHash,
  };
}

/** Where a verified browser keeps its proof: one cookie per link, scoped to that kind of customer page. */
export function customerAccessCookie(type: CustomerAccessResourceType, tokenHash: string) {
  return type === 'ESTIMATE'
    ? { name: `comet_quote_${tokenHash.slice(0, 16)}`, path: '/customer/quote' }
    : { name: `comet_invoice_${tokenHash.slice(0, 16)}`, path: '/customer/invoice' };
}
