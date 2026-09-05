import { PrismaClient } from '@prisma/client';
import { companyOsPrismaUrl } from './prisma-url';

const globalForCompanyOsV3 = globalThis as unknown as { companyOsV3Prisma?: PrismaClient };

function v3Url() {
  const dedicated = (process.env.COMPANY_OS_V3_DATABASE_URL ?? '').trim();
  if (dedicated) return dedicated;
  if (process.env.NODE_ENV === 'test') return (process.env.DATABASE_URL ?? '').trim();
  throw new Error('COMPANY_OS_V3_DATABASE_URL no configurada');
}

export function companyOsV3Prisma() {
  if (!globalForCompanyOsV3.companyOsV3Prisma) {
    globalForCompanyOsV3.companyOsV3Prisma = new PrismaClient({
      datasources: { db: { url: companyOsPrismaUrl(v3Url()) } },
      log: [],
    });
  }
  return globalForCompanyOsV3.companyOsV3Prisma;
}
