import fs from 'node:fs';
import path from 'node:path';

const shipmentNumber = Number(process.env.PACKING_SHIPMENT_NUMBER);
if (!Number.isInteger(shipmentNumber) || shipmentNumber <= 0) {
  throw new Error('PACKING_SHIPMENT_NUMBER debe ser un número de envío válido.');
}

const prismaDir = path.join(process.cwd(), 'prisma');
const readSeed = (fileName) => JSON.parse(fs.readFileSync(path.join(prismaDir, fileName), 'utf8'));
const shipments = readSeed('shipments_seed.json');
const orders = readSeed('orders_seed.json');
const reconciliation = readSeed('shipment_reconciliation_seed.json');
const ordersByNumber = new Map(orders.map((order) => [order.order_number, order]));

const lines = reconciliation.flatMap((order) =>
  (order.items || [])
    .filter((item) => item.shipment_number === shipmentNumber)
    .map((item) => ({
      order_number: order.order_number,
      sku: item.sku || null,
      description: item.product_name || null,
      quantity: item.quantity || 0,
      status: item.status || null,
      present_in_current_order_import: ordersByNumber.has(order.order_number),
    }))
);

const report = {
  shipment_number: shipmentNumber,
  shipment_header: shipments.find((shipment) => shipment.shipment_number === shipmentNumber) || null,
  totals: {
    lines: lines.length,
    quantity: lines.reduce((sum, line) => sum + line.quantity, 0),
  },
  lines,
};

const outputDir = path.join(process.cwd(), 'audit-output');
fs.mkdirSync(outputDir, { recursive: true });
const outputPath = path.join(outputDir, `packing-source-${shipmentNumber}.json`);
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Reporte de fuente generado: ${outputPath}`);

if (!report.shipment_header || report.totals.lines === 0) {
  process.exitCode = 1;
}
