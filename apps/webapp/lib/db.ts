import { NODE_ENV } from '@/lib/env';
import { Prisma, PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  ensureHasGraphsColumnPromise: Promise<void> | undefined;
  hasRegisteredGuard: boolean | undefined;
};

const basePrisma = globalForPrisma.prisma ?? new PrismaClient();

if (NODE_ENV !== 'production') globalForPrisma.prisma = basePrisma;

const getDirectDatabaseUrl = () => {
  const directUrlEnvVars = [
    'POSTGRES_URL_NON_POOLING',
    'DIRECT_URL',
    'POSTGRES_PRISMA_DIRECT_URL',
    'POSTGRES_DIRECT_URL',
    'DATABASE_DIRECT_URL',
    'DATABASE_MIGRATION_URL',
  ] as const;

  for (const key of directUrlEnvVars) {
    const value = process.env[key];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }

  return undefined;
};

const ensureHasGraphsColumn = async () => {
  const directDatabaseUrl = getDirectDatabaseUrl();

  const guardPrisma = directDatabaseUrl
    ? new PrismaClient({
        datasources: {
          db: {
            url: directDatabaseUrl,
          },
        },
      })
    : new PrismaClient();

  try {
    const result = await guardPrisma.$queryRaw<{ exists: boolean }[]>`
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
      await guardPrisma.$executeRawUnsafe(
        'ALTER TABLE "SourceSet" ADD COLUMN "hasGraphs" BOOLEAN NOT NULL DEFAULT false;'
      );
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes('column "hasGraphs" of relation "SourceSet" already exists')
      ) {
        return;
      }

      if (
        (error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2010' &&
          typeof error.meta?.message === 'string' &&
          error.meta.message.includes('must be owner of table SourceSet')) ||
        (error instanceof Error && error.message.includes('must be owner of table SourceSet'))
      ) {
        throw new Error(
          'SourceSet.hasGraphs column is missing and automatic migration failed because the configured direct database connection lacks permission to ALTER the SourceSet table. Run `prisma migrate deploy` using a role that owns the table or update POSTGRES_URL_NON_POOLING to use an owner role.',
          { cause: error }
        );
      }

      throw error;
    }
  } finally {
    await guardPrisma.$disconnect();
  }
};

export const ensurePrismaSchemaReady = () => {
  if (!globalForPrisma.ensureHasGraphsColumnPromise) {
    globalForPrisma.ensureHasGraphsColumnPromise = ensureHasGraphsColumn();
  }

  return globalForPrisma.ensureHasGraphsColumnPromise;
};

if (!globalForPrisma.hasRegisteredGuard) {
  basePrisma.$use(async (params, next) => {
    await ensurePrismaSchemaReady();
    return next(params);
  });

  globalForPrisma.hasRegisteredGuard = true;
}

export const prisma = basePrisma;
