import { getPackingSegmentIssue, getPackingSegments, getShipmentChargeIssue, projectShipmentForPacking } from '../lib/packing-segments';
import { buildShipmentItems } from '../lib/shipment-items';
import { canUseSegmentedPackingForShipmentBlock } from '../lib/source-document-guard';

const ramiro = { id: 72, old_id: 72, name: 'Ramiro Star Computacion' };
const marcos = { id: 162, old_id: 162, name: 'Marcos Roku' };
const aylen = { id: 70, old_id: 70, name: 'Aylen Gentiletti' };

const shipment = {
  id: 1188,
  shipment_number: 1188,
  client: { id: 18, old_id: 18, name: 'Diegote' },
  items: [
    { id: 1, quantity: 2, productName: 'iPhone 15', order: { id: 10, clientId: 72, client: ramiro } },
    { id: 2, quantity: 5, productName: 'iPhone 15', order: { id: 10, clientId: 72, client: ramiro } },
    { id: 3, quantity: 3, productName: 'iPhone 17', order: { id: 11, clientId: 72, client: ramiro } },
    { id: 4, quantity: 6, productName: 'iPhone 17', order: { id: 12, clientId: 162, client: marcos } },
  ],
  orders: [
    { id: 10, clientId: 72, client: ramiro, items: [] },
    { id: 11, clientId: 72, client: ramiro, items: [] },
    { id: 12, clientId: 162, client: marcos, items: [] },
  ],
};

function total(items: Array<{ quantity?: number | null }>) {
  return items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
}

async function main() {
  const segments = getPackingSegments(shipment);
  const ramiroSegment = segments.find((segment) => segment.clientId === 72);
  const marcosSegment = segments.find((segment) => segment.clientId === 162);
  if (!ramiroSegment || !marcosSegment || segments.length !== 2) {
    throw new Error('No se detectaron correctamente los dos clientes del envío compartido.');
  }
  if (marcosSegment.documentNumber !== '1188A' || ramiroSegment.documentNumber !== '1188B') {
    throw new Error('Los Packing Lists compartidos no recibieron numeración A/B estable.');
  }

  const ramiroPacking = projectShipmentForPacking(shipment, ramiroSegment, segments.length);
  const marcosPacking = projectShipmentForPacking(shipment, marcosSegment, segments.length);
  if (total(buildShipmentItems(ramiroPacking)) !== 10 || total(buildShipmentItems(marcosPacking)) !== 6) {
    throw new Error('El Packing segmentado mezcla artículos o cantidades entre clientes.');
  }
  if (!ramiroPacking.packingSegment.isSharedShipment || ramiroPacking.client.id !== 72 || marcosPacking.client.id !== 162) {
    throw new Error('El Packing segmentado no conserva el cliente correcto ni la condición de envío compartido.');
  }
  if (getPackingSegmentIssue(shipment)) {
    throw new Error('El envío segmentado correcto no debe quedar bloqueado.');
  }

  const unresolvedShipment = {
    ...shipment,
    items: [...shipment.items, { id: 5, quantity: 1, order: null }],
  };
  if (!getPackingSegmentIssue(unresolvedShipment)) {
    throw new Error('Un artículo sin cliente debe bloquear el Packing List.');
  }
  if (!canUseSegmentedPackingForShipmentBlock('La fuente contiene más de una cabecera incompatible para el mismo número de envío.', true)) {
    throw new Error('La colisión de cabecera compartida verificada debe permitir segmentación.');
  }
  if (canUseSegmentedPackingForShipmentBlock('Error de fuente distinto', true)) {
    throw new Error('Un bloqueo de fuente distinto debe seguir bloqueando el Packing List.');
  }
  if (!getShipmentChargeIssue(shipment, ramiro.id)?.includes('más de un cliente')) {
    throw new Error('Un envío compartido no puede atribuir un cargo común a un cliente.');
  }

  const oneClientShipment = {
    ...shipment,
    items: shipment.items.filter((item) => item.order.clientId === ramiro.id),
    orders: shipment.orders.filter((order) => order.clientId === ramiro.id),
  };
  if (getShipmentChargeIssue(oneClientShipment, ramiro.id)) {
    throw new Error('Un envío de un solo cliente debe admitir su cargo.');
  }
  if (!getShipmentChargeIssue(oneClientShipment, marcos.id)?.includes('no corresponde')) {
    throw new Error('Un cargo no puede atribuirse a un cliente ajeno al envío.');
  }

  const shipment1232 = {
    id: 7002,
    shipment_number: 1232,
    client: aylen,
    cargo_description: '2 x S26 ULTRA',
    item_count: 10,
    items: [
      { id: 20, quantity: 10, productName: 'iPhone 16 128GB', order: { id: 2566, clientId: 501, client: { id: 501, old_id: 265, name: 'Federico Esquivel - Canning' } } },
    ],
    orders: [
      { id: 2566, clientId: 501, client: { id: 501, old_id: 265, name: 'Federico Esquivel - Canning' }, items: [] },
    ],
  };
  const segments1232 = getPackingSegments(shipment1232);
  const aylen1232 = segments1232.find((segment) => segment.clientId === 70);
  const fede1232 = segments1232.find((segment) => segment.clientId === 501);
  if (segments1232.length !== 2 || aylen1232?.documentNumber !== '1232A' || fede1232?.documentNumber !== '1232B') {
    throw new Error('El envío #1232 no se separó correctamente entre Aylen y Federico.');
  }
  const aylenPacking1232 = projectShipmentForPacking(shipment1232, aylen1232!, segments1232.length);
  const fedePacking1232 = projectShipmentForPacking(shipment1232, fede1232!, segments1232.length);
  if (aylenPacking1232.cargo_description !== '2 x S26 ULTRA' || aylenPacking1232.item_count !== 2 || buildShipmentItems(aylenPacking1232).length !== 0) {
    throw new Error('El PL #1232A no conserva exclusivamente la carga directa de Aylen.');
  }
  if (total(buildShipmentItems(fedePacking1232)) !== 10 || fedePacking1232.cargo_description) {
    throw new Error('El PL #1232B no conserva exclusivamente los artículos de Federico.');
  }

  console.log('OK: el Packing de un envío compartido se segmenta por cliente sin mezclar cantidades.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
