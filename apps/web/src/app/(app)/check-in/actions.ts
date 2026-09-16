'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireUser, requirePermission } from '@/lib/auth/authorize';
import { allocateDocumentNumber } from '@/lib/numbering';
import { writeAuditLog } from '@/lib/audit';

export interface CustomerSearchResult {
  customerId: string;
  name: string;
  phone: string;
  vehicles: { vehicleId: string; plateNumber: string; make: string; model: string }[];
}

export async function searchCustomers(query: string): Promise<CustomerSearchResult[]> {
  const user = await requireUser();
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const customers = await prisma.customer.findMany({
    where: {
      organizationId: user.organizationId,
      isActive: true,
      OR: [
        { name: { contains: trimmed, mode: 'insensitive' } },
        { phone: { contains: trimmed } },
        { vehicles: { some: { plateNumber: { contains: trimmed, mode: 'insensitive' } } } },
      ],
    },
    include: { vehicles: { where: { isActive: true } } },
    take: 10,
  });

  return customers.map((customer) => ({
    customerId: customer.id,
    name: customer.name,
    phone: customer.phone,
    vehicles: customer.vehicles.map((v) => ({
      vehicleId: v.id,
      plateNumber: v.plateNumber,
      make: v.make,
      model: v.model,
    })),
  }));
}

const existingSchema = z.object({
  mode: z.literal('existing'),
  customerId: z.uuid(),
  vehicleId: z.uuid(),
  complaint: z.string().min(1, 'Complaint is required'),
  mileage: z.coerce.number().int().nonnegative().optional(),
});

const newSchema = z.object({
  mode: z.literal('new'),
  customerName: z.string().min(1, 'Customer name is required'),
  customerPhone: z.string().min(1, 'Mobile number is required'),
  customerEmail: z.email().optional().or(z.literal('')),
  plateNumber: z.string().min(1, 'Plate number is required'),
  make: z.string().min(1, 'Make is required'),
  model: z.string().min(1, 'Model is required'),
  year: z.coerce.number().int().optional(),
  complaint: z.string().min(1, 'Complaint is required'),
  mileage: z.coerce.number().int().nonnegative().optional(),
});

const checkInSchema = z.discriminatedUnion('mode', [existingSchema, newSchema]);

export interface CheckInState {
  error?: string;
}

export async function checkIn(_prevState: CheckInState, formData: FormData): Promise<CheckInState> {
  const user = await requireUser();
  requirePermission(user, 'job_card.create');

  if (!user.primaryBranchId) {
    return { error: 'Your account has no primary branch assigned. Contact an administrator.' };
  }
  const branchId = user.primaryBranchId;

  const raw = Object.fromEntries(formData.entries());
  const parsed = checkInSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid check-in details.' };
  }
  const input = parsed.data;

  const jobCardId = await prisma.$transaction(async (tx) => {
    let customerId: string;
    let vehicleId: string;

    if (input.mode === 'existing') {
      const vehicle = await tx.vehicle.findFirstOrThrow({
        where: { id: input.vehicleId, customerId: input.customerId, organizationId: user.organizationId },
      });
      customerId = input.customerId;
      vehicleId = vehicle.id;
      if (input.mileage !== undefined) {
        await tx.vehicle.update({ where: { id: vehicleId }, data: { lastMileage: input.mileage } });
      }
    } else {
      const customer = await tx.customer.create({
        data: {
          organizationId: user.organizationId,
          name: input.customerName,
          phone: input.customerPhone,
          email: input.customerEmail || null,
        },
      });
      const vehicle = await tx.vehicle.create({
        data: {
          organizationId: user.organizationId,
          customerId: customer.id,
          plateNumber: input.plateNumber,
          make: input.make,
          model: input.model,
          year: input.year ?? null,
          lastMileage: input.mileage ?? null,
        },
      });
      customerId = customer.id;
      vehicleId = vehicle.id;

      await writeAuditLog(tx, {
        organizationId: user.organizationId,
        branchId,
        actorUserId: user.id,
        action: 'customer.created',
        entityType: 'Customer',
        entityId: customer.id,
      });
      await writeAuditLog(tx, {
        organizationId: user.organizationId,
        branchId,
        actorUserId: user.id,
        action: 'vehicle.created',
        entityType: 'Vehicle',
        entityId: vehicle.id,
      });
    }

    const jobNumber = await allocateDocumentNumber(tx, user.organizationId, branchId, 'JOB_CARD');

    const jobCard = await tx.jobCard.create({
      data: {
        organizationId: user.organizationId,
        branchId,
        vehicleId,
        jobNumber,
        status: 'RECEIVED',
        odometerReading: input.mileage ?? null,
        customerComplaint: input.complaint,
        createdByUserId: user.id,
      },
    });

    await tx.jobStatusHistory.create({
      data: {
        organizationId: user.organizationId,
        jobCardId: jobCard.id,
        fromStatus: null,
        toStatus: 'RECEIVED',
        changedByUserId: user.id,
      },
    });

    await writeAuditLog(tx, {
      organizationId: user.organizationId,
      branchId,
      actorUserId: user.id,
      action: 'job_card.created',
      entityType: 'JobCard',
      entityId: jobCard.id,
      afterData: { status: 'RECEIVED', vehicleId, customerId },
    });

    return jobCard.id;
  });

  redirect(`/job-cards/${jobCardId}`);
}
