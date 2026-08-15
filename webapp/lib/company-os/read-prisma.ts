import { PrismaClient } from '@prisma/client';

const globalForCompanyOs = globalThis as unknown as { companyOsReadPrisma?: PrismaClient };

function getReadOnlyUrl() {
  const dedicated = (process.env.COMPANY_OS_DATABASE_URL ?? '').trim();
  if (dedicated) return dedicated;
  if (process.env.NODE_ENV !== 'production') return (process.env.DATABASE_URL ?? '').trim();
  return '';
}

export function companyReadPrisma() {
  const url = getReadOnlyUrl();
  if (!url) throw new Error('COMPANY_OS_DATABASE_URL no configurada');
  if (!globalForCompanyOs.companyOsReadPrisma) {
    globalForCompanyOs.companyOsReadPrisma = new PrismaClient({
      datasources: { db: { url } },
      log: [],
    });
  }
  return globalForCompanyOs.companyOsReadPrisma;
}
