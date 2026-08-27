-- Close unintended Data API access to the internal price-list load receipt.
-- Server-side Prisma writes keep using the private database connection.
BEGIN;

ALTER TABLE public."SupplierPriceListLoad" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."SupplierPriceListLoad" FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public."SupplierPriceListLoad"
  FROM PUBLIC, anon, authenticated, company_os_reader, company_os_v3;

COMMENT ON TABLE public."SupplierPriceListLoad" IS
  'Internal server-side receipt. Not exposed through the Supabase Data API.';

COMMIT;
