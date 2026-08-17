import assert from 'node:assert/strict';
import { extractSupplierList } from '../lib/ingestion/openai';

async function main() {
  const sample = 'IPH 16PM 256GB BLK NEW US USD 1095 x3';
  const { extraction, model } = await extractSupplierList(sample);
  assert.equal(extraction.items.length, 1);
  assert.equal(extraction.items[0]?.lineNumber, 1);
  assert.equal(extraction.items[0]?.rawLine, sample);
  assert.equal(extraction.items[0]?.costUsd, 1095);
  assert.equal(extraction.items[0]?.quantity, 3);
  console.log(JSON.stringify({ ok: true, model, items: extraction.items.length }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
