import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';

// Standard Next.js dev-mode singleton guard: without this, every hot reload
// would open a new pool of Postgres connections against the same process.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createPrismaClient() {
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL ?? throwMissingDatabaseUrl(),
  });
  return new PrismaClient({ adapter });
}

function throwMissingDatabaseUrl(): never {
  throw new Error('DATABASE_URL is not set. Copy .env.example to .env and fill in real values.');
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
