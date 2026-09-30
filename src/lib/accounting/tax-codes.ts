import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import type { VatTreatment } from '@/generated/prisma/enums';
import { prisma } from '@/lib/prisma';
import type { AuthenticatedUser } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/authorize';
import { writeAuditLog } from '@/lib/audit';
import { DomainError, NotFoundError } from '@/lib/errors';
import { parseInput } from '@/lib/form-data';
import { VAT_TREATMENT_LABEL } from '@/lib/vat-treatment';

/*
 * The tax code master.
 *
 * Every sales and purchase line is given a tax code; the code decides its
 * rate and where it goes on the VAT return. The four standard UAE codes are
 * created for every workshop the first time they are needed:
 *
 *   SR  Standard rated      the workshop's VAT rate   Box 1 / Box 9
 *   ZR  Zero rated          0%                         Box 4
 *   EX  Exempt              0%                         Box 5
 *   OS  Out of scope        0%                         not reported
 *
 * More can be added (another rate, a code for disbursements…). A code's rate
 * and treatment are COPIED onto each line when it is saved — the line keeps
 * them for ever — so changing or retiring a code only changes what new lines
 * are priced at. Issued documents never move.
 *
 * SR is the workshop's standard rate: changing its rate here changes the rate
 * in Settings, and the other way round, so there is one standard rate.
 */

type Tx = Prisma.TransactionClient;
type Client = Tx | typeof prisma;

export interface TaxCodeOption {
  id: string;
  code: string;
  name: string;
  /** Percentage with two decimals, e.g. "5.00". */
  rate: string;
  treatment: VatTreatment;
  isDefault: boolean;
}

const STANDARD: {
  code: string;
  name: string;
  treatment: VatTreatment;
}[] = [
  { code: 'SR', name: 'Standard rated', treatment: 'STANDARD' },
  { code: 'ZR', name: 'Zero rated', treatment: 'ZERO_RATED' },
  { code: 'EX', name: 'Exempt', treatment: 'EXEMPT' },
  { code: 'OS', name: 'Out of scope', treatment: 'OUT_OF_SCOPE' },
];

/**
 * Makes sure the workshop has its standard codes. Safe to call anywhere, any
 * number of times: codes it already has are left alone, whatever they were
 * renamed to.
 */
export async function ensureTaxCodes(client: Client, organizationId: string) {
  const existing = await client.taxCode.count({ where: { organizationId } });
  if (existing > 0) return;
  const organization = await client.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { vatRate: true, isVatRegistered: true },
  });
  // A business that is not registered charges no VAT: its lines start out of scope.
  const defaultCode = organization.isVatRegistered ? 'SR' : 'OS';
  await client.taxCode.createMany({
    data: STANDARD.map((code) => ({
      organizationId,
      code: code.code,
      name: code.name,
      treatment: code.treatment,
      rate: code.treatment === 'STANDARD' ? organization.vatRate.toFixed(2) : '0.00',
      isSystem: true,
      isDefault: code.code === defaultCode,
    })),
    skipDuplicates: true,
  });
}

const toOption = (code: {
  id: string;
  code: string;
  name: string;
  rate: { toString(): string };
  treatment: VatTreatment;
  isDefault: boolean;
}): TaxCodeOption => ({
  id: code.id,
  code: code.code,
  name: code.name,
  rate: Number(code.rate.toString()).toFixed(2),
  treatment: code.treatment,
  isDefault: code.isDefault,
});

/**
 * The codes a form offers: active, for sales or for purchases, the default
 * first. No permission check — it is read inside screens that already have one.
 */
export async function getTaxCodeOptions(
  organizationId: string,
  usage: 'sales' | 'purchases',
): Promise<TaxCodeOption[]> {
  await ensureTaxCodes(prisma, organizationId);
  const codes = await prisma.taxCode.findMany({
    where: {
      organizationId,
      isActive: true,
      ...(usage === 'sales' ? { forSales: true } : { forPurchases: true }),
    },
    orderBy: [{ isDefault: 'desc' }, { code: 'asc' }],
  });
  return codes.map(toOption);
}

/**
 * The codes named on a set of lines, checked to be the workshop's own and in
 * use — what pricing reads the rate and treatment from.
 */
export async function resolveTaxCodes(
  client: Client,
  organizationId: string,
  lines: { taxCodeId?: string | null }[],
) {
  const ids = [...new Set(lines.map((line) => line.taxCodeId).filter(Boolean) as string[])];
  const map = new Map<string, TaxCodeOption>();
  if (ids.length === 0) return map;
  const codes = await client.taxCode.findMany({
    where: { organizationId, id: { in: ids }, isActive: true },
  });
  for (const code of codes) map.set(code.id, toOption(code));
  lines.forEach((line, index) => {
    if (line.taxCodeId && !map.has(line.taxCodeId)) {
      throw new DomainError(
        `Line ${index + 1}: choose a tax code that is in use.`,
        `items.${index}`,
      );
    }
  });
  return map;
}

/** One code by id, checked the same way — for an expense or a single line. */
export async function resolveTaxCode(client: Client, organizationId: string, taxCodeId: string) {
  const code = await client.taxCode.findFirst({
    where: { organizationId, id: taxCodeId, isActive: true },
  });
  if (!code) throw new DomainError('Choose a tax code that is in use.', 'taxCodeId');
  return toOption(code);
}

/** Keeps SR's rate the same as the standard rate in Settings. Called from Settings. */
export async function syncStandardRate(tx: Tx, organizationId: string, rate: string) {
  await tx.taxCode.updateMany({
    where: { organizationId, isSystem: true, treatment: 'STANDARD' },
    data: { rate },
  });
}

// ─── The master screen ──────────────────────────────────────────────────────

export async function listTaxCodes(user: AuthenticatedUser) {
  requirePermission(user, 'settings.view');
  await ensureTaxCodes(prisma, user.organizationId);
  const codes = await prisma.taxCode.findMany({
    where: { organizationId: user.organizationId },
    orderBy: [{ isActive: 'desc' }, { isSystem: 'desc' }, { code: 'asc' }],
    include: {
      _count: {
        select: { invoiceItems: true, estimateItems: true, purchaseItems: true, expenses: true },
      },
    },
  });
  return codes.map((code) => ({
    ...toOption(code),
    forSales: code.forSales,
    forPurchases: code.forPurchases,
    isSystem: code.isSystem,
    isActive: code.isActive,
    treatmentLabel: VAT_TREATMENT_LABEL[code.treatment],
    uses:
      code._count.invoiceItems +
      code._count.estimateItems +
      code._count.purchaseItems +
      code._count.expenses,
  }));
}

export type TaxCodeRow = Awaited<ReturnType<typeof listTaxCodes>>[number];

const codeSchema = z.object({
  code: z
    .string({ error: 'Enter a short code.' })
    .trim()
    .min(1, 'Enter a short code.')
    .max(10, 'Keep the code to 10 characters.')
    .regex(/^[A-Za-z0-9-]+$/, 'Use letters, digits and dashes only.'),
  name: z.string({ error: 'Enter a name.' }).trim().min(2, 'Enter a name.').max(80),
  rate: z
    .string({ error: 'Enter the rate.' })
    .trim()
    .regex(/^\d{1,3}(\.\d{1,2})?$/, 'Enter a rate like 5 or 5.00.'),
  treatment: z.enum(['STANDARD', 'ZERO_RATED', 'EXEMPT', 'OUT_OF_SCOPE'], {
    error: 'Choose how it is reported.',
  }),
  forSales: z.enum(['on', 'true', 'false', '']).optional(),
  forPurchases: z.enum(['on', 'true', 'false', '']).optional(),
  isDefault: z.enum(['on', 'true', 'false', '']).optional(),
  isActive: z.enum(['on', 'true', 'false', '']).optional(),
});

const ticked = (value: string | undefined) => value === 'on' || value === 'true';

function readCode(input: z.infer<typeof codeSchema>) {
  const rate = Number(input.rate);
  if (rate > 100) throw new DomainError('A rate can’t be more than 100%.', 'rate');
  if (input.treatment === 'STANDARD' && rate <= 0) {
    throw new DomainError('A standard-rated code needs a rate above 0%.', 'rate');
  }
  if (input.treatment !== 'STANDARD' && rate !== 0) {
    throw new DomainError(
      `${VAT_TREATMENT_LABEL[input.treatment]} is always 0%. Use a standard-rated code for a rate.`,
      'rate',
    );
  }
  const forSales = ticked(input.forSales);
  const forPurchases = ticked(input.forPurchases);
  if (!forSales && !forPurchases) {
    throw new DomainError('Offer it on sales, on purchases, or both.', 'forSales');
  }
  return {
    code: input.code.toUpperCase(),
    name: input.name.replace(/\s+/g, ' '),
    rate: rate.toFixed(2),
    treatment: input.treatment,
    forSales,
    forPurchases,
  };
}

async function assertCodeFree(client: Client, organizationId: string, code: string, exceptId?: string) {
  const clash = await client.taxCode.findFirst({
    where: {
      organizationId,
      code: { equals: code, mode: 'insensitive' },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { name: true },
  });
  if (clash) throw new DomainError(`That code is already used by “${clash.name}”.`, 'code');
}

export async function createTaxCode(user: AuthenticatedUser, rawInput: unknown) {
  requirePermission(user, 'settings.create');
  const input = parseInput(codeSchema, rawInput);
  const data = readCode(input);
  const isDefault = ticked(input.isDefault);

  return prisma.$transaction(async (tx) => {
    await ensureTaxCodes(tx, user.organizationId);
    await assertCodeFree(tx, user.organizationId, data.code);
    if (isDefault) {
      await tx.taxCode.updateMany({
        where: { organizationId: user.organizationId, isDefault: true },
        data: { isDefault: false },
      });
    }
    const code = await tx.taxCode.create({
      data: { organizationId: user.organizationId, ...data, isDefault },
    });
    await writeAuditLog(tx, {
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: 'tax_code.created',
      entityType: 'TaxCode',
      entityId: code.id,
      afterData: { ...data, isDefault },
    });
    return code;
  });
}

/**
 * Changes a code for the lines saved from now on. A standard code keeps its
 * treatment; SR's rate is the workshop's standard rate and moves Settings
 * with it. The default code can't be retired — choose another default first.
 */
export async function updateTaxCode(user: AuthenticatedUser, taxCodeId: string, rawInput: unknown) {
  requirePermission(user, 'settings.edit');
  const input = parseInput(codeSchema, rawInput);

  return prisma.$transaction(async (tx) => {
    const before = await tx.taxCode.findFirst({
      where: { id: taxCodeId, organizationId: user.organizationId },
    });
    if (!before) throw new NotFoundError('tax code');
    const data = readCode(input);
    if (before.isSystem && data.treatment !== before.treatment) {
      throw new DomainError('A standard code keeps its VAT treatment. Add a new code instead.', 'treatment');
    }
    const isDefault = ticked(input.isDefault);
    const isActive = input.isActive === undefined ? before.isActive : ticked(input.isActive);
    if (!isActive && (isDefault || before.isDefault)) {
      throw new DomainError('The default code can’t be retired. Make another code the default first.', 'isActive');
    }
    await assertCodeFree(tx, user.organizationId, data.code, before.id);
    if (isDefault && !before.isDefault) {
      await tx.taxCode.updateMany({
        where: { organizationId: user.organizationId, isDefault: true },
        data: { isDefault: false },
      });
    }
    const code = await tx.taxCode.update({
      where: { id: before.id },
      data: { ...data, isDefault: isDefault || before.isDefault, isActive },
    });
    if (before.isSystem && before.treatment === 'STANDARD' && data.rate !== before.rate.toFixed(2)) {
      await tx.organization.update({
        where: { id: user.organizationId },
        data: { vatRate: data.rate },
      });
    }
    await writeAuditLog(tx, {
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: 'tax_code.updated',
      entityType: 'TaxCode',
      entityId: code.id,
      beforeData: {
        code: before.code,
        name: before.name,
        rate: before.rate.toFixed(2),
        treatment: before.treatment,
        forSales: before.forSales,
        forPurchases: before.forPurchases,
        isDefault: before.isDefault,
        isActive: before.isActive,
      },
      afterData: { ...data, isDefault: code.isDefault, isActive },
    });
    return code;
  });
}
