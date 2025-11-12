import { NODE_ENV } from '@/lib/env';
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  ensureHasGraphsColumnPromise: Promise<void> | undefined;
};

const basePrisma = globalForPrisma.prisma ?? new PrismaClient();

if (NODE_ENV !== 'production') globalForPrisma.prisma = basePrisma;

const ensureHasGraphsColumn = async () => {
  const result = await basePrisma.$queryRaw<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'SourceSet'
        AND column_name = 'hasGraphs'
    ) AS "exists";
  `;

  const hasColumn = result?.[0]?.exists ?? false;

  if (hasColumn) {
    return;
  }

  try {
    await basePrisma.$executeRawUnsafe(
      'ALTER TABLE "SourceSet" ADD COLUMN "hasGraphs" BOOLEAN NOT NULL DEFAULT false;'
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('column "hasGraphs" of relation "SourceSet" already exists')
    ) {
      return;
    }

    throw error;
  }
};

export const ensurePrismaSchemaReady = () => {
  if (!globalForPrisma.ensureHasGraphsColumnPromise) {
    globalForPrisma.ensureHasGraphsColumnPromise = ensureHasGraphsColumn();
  }

  return globalForPrisma.ensureHasGraphsColumnPromise;
};

export const prisma = basePrisma.$extends({
  query: {
    $allModels: {
      async $allOperations({ args, query }) {
        await ensurePrismaSchemaReady();
        return query(args);
      },
    },
  },
});
