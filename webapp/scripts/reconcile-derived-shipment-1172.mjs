import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const apply = process.env.APPLY === '1';

const correction = {
  shipmentNumber: 1172,
  orderNumber: 2479,
  clientId: 72,
  shippedAt: new Date('2026-05-07T00:00:00.000Z'),
  status: 'ENTREGADO',
  typeLoad: 'TABLET/IPADS',
  itemCount: 6,
  priceTotal: 7230,
  costTotal: 7170,
  profit: 60,
  expectedItems: [
    { productName: 'Apple iPad Pro 13" M5 512GB Wi-Fi', quantity: 1, unitPrice: 1325, unitCost: 1315 },
    { productName: 'Apple iPad Pro 13" M5 512GB Wi-Fi', quantity: 1, unitPrice: 1325, unitCost: 1315 },
    { productName: 'Apple iPad Pro 13" M5 256GB Wi-Fi', quantity: 2, unitPrice: 1145, unitCost: 1135 },
    { productName: 'Apple iPad Pro 13" M5 256GB Wi-Fi', quantity: 2, unitPrice: 1145, unitCost: 1135 },
  ],
};

function equalsMoney(left, right) {
  return Math.abs(Number(left) - Number(right)) < 0.000001;
}

function sameItems(actual) {
  if (actual.length !== correction.expectedItems.length) return false;
  return actual.every((item, index) => {
    const expected = correction.expectedItems[index];
    return item.productName === expected.productName
      && item.quantity === expected.quantity
      && equalsMoney(item.unit_price, expected.unitPrice)
      && equalsMoney(item.unit_cost, expected.unitCost)
      && item.status === correction.status
      && item.shipmentId === null;
  });
}

async function main() {
  const [existingShipment, order] = await Promise.all([
    prisma.shipment.findUnique({ where: { shipment_number: correction.shipmentNumber } }),
    prisma.order.findUnique({
      where: { order_number: correction.orderNumber },
      include: { items: { orderBy: { id: 'asc' } } },
    }),
  ]);

  if (existingShipment) {
    throw new Error(`El envío #${correction.shipmentNumber} ya existe (id ${existingShipment.id}); no se aplica una cabecera derivada.`);
  }
  if (!order) throw new Error(`No existe el pedido #${correction.orderNumber}.`);
  if (order.clientId !== correction.clientId || order.status !== correction.status || !equalsMoney(order.total_amount, correction.priceTotal)) {
    throw new Error(`El pedido #${correction.orderNumber} no coincide con cliente, estado o total auditados.`);
  }
  if (order.shipmentId !== null || !sameItems(order.items)) {
    throw new Error(`Los artículos del pedido #${correction.orderNumber} cambiaron o ya tienen envío; no se modifica.`);
  }

  const plan = {
    shipmentNumber: correction.shipmentNumber,
    orderNumber: correction.orderNumber,
    clientId: correction.clientId,
    status: correction.status,
    units: correction.itemCount,
    priceTotal: correction.priceTotal,
    costTotal: correction.costTotal,
    profit: correction.profit,
    itemIds: order.items.map((item) => item.id),
  };
  console.log(JSON.stringify({ mode: apply ? 'APPLY' : 'DRY_RUN', plan }, null, 2));
  if (!apply) return;

  await prisma.$transaction(async (tx) => {
    const syncRun = await tx.syncRun.create({
      data: { scope: 'MANUAL_RECONCILIATION', status: 'RUNNING' },
    });
    const shipment = await tx.shipment.create({
      data: {
        shipment_number: correction.shipmentNumber,
        clientId: correction.clientId,
        date_shipped: correction.shippedAt,
        type_load: correction.typeLoad,
        item_count: correction.itemCount,
        price_total: correction.priceTotal,
        cost_total: correction.costTotal,
        profit: correction.profit,
        invoice: String(correction.orderNumber),
        status: correction.status,
        notes: 'Cabecera derivada de DETA_VENTAS para reconciliar el pedido #2479; la fuente no contiene CABE_ENVIOS #1172. Forwarder, pesos y arribo permanecen sin dato.',
      },
    });
    await tx.order.update({ where: { id: order.id }, data: { shipmentId: shipment.id } });
    const updatedItems = await tx.orderItem.updateMany({
      where: { id: { in: order.items.map((item) => item.id) }, shipmentId: null },
      data: { shipmentId: shipment.id },
    });
    if (updatedItems.count !== order.items.length) {
      throw new Error(`Se vincularon ${updatedItems.count}/${order.items.length} artículos; la transacción fue cancelada.`);
    }
    await tx.syncChange.create({
      data: {
        syncRunId: syncRun.id,
        entity: 'SHIPMENT',
        entityKey: '#1172',
        action: 'RECONCILED',
        reason: 'Cabecera ausente en CABE_ENVIOS; creada únicamente con los cuatro artículos y totales verificados del pedido #2479.',
        before: { shipment: null, orderShipmentId: null, itemShipmentIds: order.items.map((item) => item.shipmentId) },
        after: { shipmentId: shipment.id, orderShipmentId: shipment.id, itemIds: order.items.map((item) => item.id) },
      },
    });
    await tx.syncRun.update({
      where: { id: syncRun.id },
      data: { status: 'SUCCESS', finishedAt: new Date(), summary: { shipmentNumber: correction.shipmentNumber, orderNumber: correction.orderNumber, source: 'DETA_VENTAS' } },
    });
  });
  console.log('OK: envío #1172 reconciliado desde el pedido #2479.');
}

main()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
