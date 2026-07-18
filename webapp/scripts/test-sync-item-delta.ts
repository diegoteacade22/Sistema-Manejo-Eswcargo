import assert from 'node:assert/strict';
import { sameItemSet, type SyncComparableItem } from '../lib/sync-item-comparison';

type OrderSnapshot = { orderNumber: number; items: SyncComparableItem[] };

function changedOrderNumbers(before: OrderSnapshot[], after: OrderSnapshot[]) {
    const beforeByOrder = new Map(before.map((order) => [order.orderNumber, order.items]));
    const afterByOrder = new Map(after.map((order) => [order.orderNumber, order.items]));
    const orderNumbers = new Set([...beforeByOrder.keys(), ...afterByOrder.keys()]);

    return [...orderNumbers]
        .filter((orderNumber) => !sameItemSet(beforeByOrder.get(orderNumber) || [], afterByOrder.get(orderNumber) || []))
        .sort((a, b) => a - b);
}

const existing: OrderSnapshot[] = [
    { orderNumber: 5001, items: [{ productId: 1, productName: 'iPhone 17', quantity: 2, unit_price: 800, shipmentId: 1200, status: 'SALIENDO' }] },
    { orderNumber: 5002, items: [{ productId: 2, productName: 'iPhone 16', quantity: 1, unit_price: 650, shipmentId: 1201, status: 'SALIENDO' }] },
    { orderNumber: 5003, items: [{ productId: 3, productName: 'Samsung S26', quantity: 3, unit_price: 700, shipmentId: 1201, status: 'SALIENDO' }] },
];

const source: OrderSnapshot[] = [
    // Sin cambios: este pedido no se debe reescribir.
    { orderNumber: 5001, items: [{ productId: 1, productName: 'iPhone 17', quantity: 2, unit_price: 800, shipmentId: 1200, status: 'SALIENDO' }] },
    // Reasignación de envío.
    { orderNumber: 5002, items: [{ productId: 2, productName: 'iPhone 16', quantity: 1, unit_price: 650, shipmentId: 1202, status: 'SALIENDO' }] },
    // Baja de productos.
    { orderNumber: 5003, items: [] },
    // Alta de productos.
    { orderNumber: 5004, items: [{ productId: 4, productName: 'iPhone 15', quantity: 1, unit_price: 500, shipmentId: 1202, status: 'COMPRAR' }] },
];

assert.equal(sameItemSet(existing[0].items, [...existing[0].items].reverse()), true, 'El orden de filas no debe causar una reescritura.');
assert.deepEqual(changedOrderNumbers(existing, source), [5002, 5003, 5004]);

console.log('OK: simulación de delta aprobada. Solo se reescriben #5002, #5003 y #5004; #5001 queda intacto.');
