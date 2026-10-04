import { prisma } from '@/lib/prisma';
import type { AuthenticatedUser } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/authorize';
import { NotFoundError } from '@/lib/errors';
import { getBrand } from '@/lib/brand/brand';

/*
 * What the company letterhead prints, taken from the workshop's Settings:
 * its legal name, phone, email and address. Any signed-in user may write a
 * letter on it — these are the same details every customer document shows.
 */

export interface LetterheadDetails {
  /** The name as registered — the letterhead's headline. */
  legalName: string;
  phone: string;
  email: string;
  address: string;
  /** Starts downloaded file names, e.g. "mohammed-mowla-auto-garage". */
  filePrefix: string;
}

/** Everything a letterhead shows: the Settings details and the extras kept with the letter. */
export interface Letterhead extends Omit<LetterheadDetails, 'filePrefix'> {
  arabicName: string;
  website: string;
  /** The logo as a data URL, or empty. */
  logo: string;
}

export async function getLetterheadDetails(user: AuthenticatedUser): Promise<LetterheadDetails> {
  // The letterhead is part of the workshop settings.
  requirePermission(user, 'settings.view');
  const [organization, brand] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: user.organizationId },
      select: { name: true, legalName: true, phone: true, email: true, address: true },
    }),
    getBrand(user.organizationId),
  ]);
  if (!organization) throw new NotFoundError('workshop');
  return {
    legalName: organization.legalName ?? organization.name,
    phone: organization.phone ?? '',
    email: organization.email ?? '',
    address: organization.address ?? '',
    filePrefix: brand.filePrefix,
  };
}
