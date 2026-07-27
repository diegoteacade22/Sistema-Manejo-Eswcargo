import assert from 'node:assert/strict';
import { getAdminShipmentSearchWhere, getClientShipmentAccess, getClientShipmentVisibilityWhere } from '../lib/shipment-visibility';

const ramiro = { id: 72, old_id: 72, name: 'Ramiro Star Computacion' };
const diegote = { id: 18, old_id: 18, name: 'Diegote' };
const marcos = { id: 162, old_id: 162, name: 'Marcos Roku' };

const sharedShipment = {
    id: 1188,
    clientId: diegote.id,
    client: diegote,
    items: [
        { id: 1, quantity: 10, order: { id: 1, clientId: ramiro.id, client: ramiro } },
        { id: 2, quantity: 6, order: { id: 2, clientId: marcos.id, client: marcos } },
    ],
    orders: [],
};

const ramiroAccess = getClientShipmentAccess(sharedShipment, ramiro.id);
assert.equal(ramiroAccess?.segment?.itemCount, 10);
assert.equal(ramiroAccess?.segmentCount, 2);
assert.equal(getClientShipmentAccess(sharedShipment, diegote.id), null);

const headerOnlyShipment = { id: 1, clientId: diegote.id, client: diegote, items: [], orders: [] };
assert.equal(getClientShipmentAccess(headerOnlyShipment, diegote.id)?.segment?.clientId, diegote.id);
assert.equal(getClientShipmentAccess(headerOnlyShipment, diegote.id)?.segment?.itemCount, 0);
assert.deepEqual(getClientShipmentVisibilityWhere(ramiro.id), {
    OR: [
        { items: { some: { order: { clientId: ramiro.id } } } },
        { orders: { some: { clientId: ramiro.id } } },
        { AND: [{ clientId: ramiro.id }, { items: { none: {} } }, { orders: { none: {} } }] },
    ],
});

assert.deepEqual(getAdminShipmentSearchWhere('Federico'), {
    OR: [
        { forwarder: { contains: 'Federico', mode: 'insensitive' } },
        { client: { name: { contains: 'Federico', mode: 'insensitive' } } },
        { orders: { some: { client: { name: { contains: 'Federico', mode: 'insensitive' } } } } },
        { items: { some: { order: { client: { name: { contains: 'Federico', mode: 'insensitive' } } } } } },
    ],
});

console.log('OK: la visibilidad del cliente usa artículos confirmados y la cabecera solo es fallback sin detalle.');
