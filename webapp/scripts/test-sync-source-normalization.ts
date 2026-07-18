import { normalizeShipmentSourceRows, normalizeSourceRows } from '../lib/sync-source-normalization';

const result = normalizeSourceRows([
    { shipment_number: 1204, client: 'Ramiro', total: 380 },
    { shipment_number: 1204, client: 'Diegote', total: 57 },
    { shipment_number: 1215, client: 'Jorge', total: 120 },
    { shipment_number: 1215, client: 'Jorge', total: 120 },
], 'shipment_number');

if (result.accepted.length !== 1 || result.accepted[0].shipment_number !== 1215) {
    throw new Error('La normalización no conservó el duplicado idéntico como una sola cabecera.');
}
if (result.rejected.length !== 1 || result.rejected[0].key !== '1204') {
    throw new Error('La normalización no rechazó la cabecera ambigua.');
}

console.log('OK: las cabeceras ambiguas se rechazan y los duplicados idénticos se deduplican.');

const sharedShipment = normalizeShipmentSourceRows([
    {
        shipment_number: 1204,
        old_client_id: 18,
        client_name_match: 'Diegote',
        forwarder: 'MARCELO HM',
        date_shipped: '2026-07-10',
        date_arrived: '2026-07-13',
        type_load: 'CELLS',
        status: 'ENTREGADO',
        notes: null,
        weight_fw: 0.6,
        weight_cli: 0.6,
        price_total: 57,
        cost_total: 39,
        profit: 18,
    },
    {
        shipment_number: 1204,
        old_client_id: 72,
        client_name_match: 'Ramiro Star Computacion',
        forwarder: 'MARCELO HM',
        date_shipped: '2026-07-10',
        date_arrived: '2026-07-13',
        type_load: 'CELLS',
        status: 'ENTREGADO',
        notes: null,
        weight_fw: 3.9,
        weight_cli: 4,
        price_total: 380,
        cost_total: 253.5,
        profit: 126.5,
    },
]);

if (sharedShipment.rejected.length !== 0 || sharedShipment.shared.length !== 1) {
    throw new Error('La cabecera compartida con operación idéntica debe consolidarse.');
}
if (sharedShipment.accepted[0].price_total !== 437 || sharedShipment.accepted[0].weight_fw !== 4.5) {
    throw new Error('La cabecera compartida no sumó correctamente sus componentes operativos.');
}
if (sharedShipment.freightRows.length !== 2 || sharedShipment.freightRows[1].price_total !== 380) {
    throw new Error('Los cargos de flete por cliente no se preservaron.');
}

const conflictingShipment = normalizeShipmentSourceRows([
    { ...sharedShipment.freightRows[0], status: 'ENTREGADO' },
    { ...sharedShipment.freightRows[1], status: 'SALIENDO' },
]);
if (conflictingShipment.rejected.length !== 1) {
    throw new Error('Una diferencia operacional real debe continuar bloqueada.');
}

console.log('OK: los envíos compartidos se consolidan sin perder cargos y los conflictos reales se bloquean.');
