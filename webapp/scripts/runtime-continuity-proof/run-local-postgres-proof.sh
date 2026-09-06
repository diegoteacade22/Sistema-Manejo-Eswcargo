#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
test -f lib/company-os/runtime-result-receipts.ts || { echo 'Receipt implementation must be integrated first'; exit 1; }
proof_container="company-os-runtime-continuity-proof-$$"
cleanup() { docker rm -f "$proof_container" >/dev/null 2>&1 || true; }
trap cleanup EXIT
# Ephemeral database; no volume, production credential, worker or model.
docker run -d --name "$proof_container" -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=company_os_proof -p 127.0.0.1::5432 postgres:17-alpine >/dev/null
proof_port="$(docker port "$proof_container" 5432 | cut -d: -f2)"
export NODE_ENV=test ESW_PRISMA_QUERY_LOG=0 CHECKPOINT_DISABLE=1
export COMPANY_OS_V3_DATABASE_URL="postgresql://postgres@127.0.0.1:${proof_port}/company_os_proof"
export COMPANY_OS_DATABASE_URL="$COMPANY_OS_V3_DATABASE_URL"
export COMPANY_OS_READ_DATABASE_URL="$COMPANY_OS_V3_DATABASE_URL"
export DATABASE_URL="$COMPANY_OS_V3_DATABASE_URL" DIRECT_URL="$COMPANY_OS_V3_DATABASE_URL"
for proof_attempt in $(seq 1 30); do
  if docker exec "$proof_container" pg_isready -h 127.0.0.1 -U postgres -d company_os_proof >/dev/null 2>&1; then break; fi
  sleep 0.2
done
node node_modules/prisma/build/index.js db push --skip-generate
node scripts/runtime-continuity-proof/schema-fixture.mjs | docker exec -i "$proof_container" psql -v ON_ERROR_STOP=1 -U postgres -d company_os_proof >/dev/null
node --import tsx scripts/runtime-continuity-proof/receipt-postgres-proof.ts
