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
    { ...sharedShipment.freightRows[0], date_shipped: '2026-07-10' },
    { ...sharedShipment.freightRows[1], date_shipped: '2026-07-11' },
]);
if (conflictingShipment.rejected.length !== 1) {
    throw new Error('Una diferencia operacional real debe continuar bloqueada.');
}

const mixedSharedShipment = normalizeShipmentSourceRows([
    {
        shipment_number: 662,
        old_client_id: 162,
        forwarder: 'JORGE GIOSA',
        date_shipped: '2025-09-19T00:00:00',
        date_arrived: '2025-09-25T00:00:00',
        type_load: 'CARGA',
        status: 'COMPRAR',
        weight_fw: 1.1,
        weight_cli: 41.8,
        price_total: 0,
        cost_total: 41.8,
    },
    {
        shipment_number: 662,
        old_client_id: 251,
        forwarder: 'JORGE GIOSA',
        date_shipped: '2025-09-19T00:00:00',
        date_arrived: '2025-09-25T00:00:00',
        type_load: 'IP17',
        status: 'COMPRAR',
        weight_fw: 0.6,
        weight_cli: 0.6,
        price_total: 84,
        cost_total: 0,
    },
]);
if (mixedSharedShipment.rejected.length !== 0 || mixedSharedShipment.shared.length !== 1) {
    throw new Error('Un envío físico compartido puede contener tipos de carga distintos por cliente.');
}
if (Math.abs(Number(mixedSharedShipment.accepted[0].weight_fw) - 1.7) > 0.000001
    || mixedSharedShipment.accepted[0].price_total !== 84
    || mixedSharedShipment.accepted[0].weight_cli !== 0.6) {
    throw new Error('El envío compartido mixto no consolidó sus importes y pesos.');
}

const canonicalShipment = normalizeShipmentSourceRows([
    {
        shipment_number: 659,
        old_client_id: 173,
        forwarder: 'JORGE GIOSA',
        date_shipped: '2025-09-19T00:00:00',
        date_arrived: '2025-09-25T00:00:00',
        price_total: 110,
    },
    {
        shipment_number: 659,
        old_client_id: 119,
        forwarder: 'UNLIMITED',
        date_shipped: '2025-09-17T00:00:00',
        date_arrived: '2025-09-22T00:00:00',
        price_total: 132,
    },
], {
    '659': {
        match: {
            old_client_id: 119,
            forwarder: 'UNLIMITED',
            date_shipped: '2025-09-17T00:00:00',
        },
        source: 'CABE_ENVIOS filas 527:528',
    },
});
if (canonicalShipment.rejected.length !== 0
    || canonicalShipment.resolved.length !== 1
    || canonicalShipment.accepted[0].old_client_id !== 119) {
    throw new Error('La selección canónica no resolvió la cabecera incompatible #659.');
}
if (canonicalShipment.freightRows.length !== 2) {
    throw new Error('La selección canónica no preservó las asignaciones de flete de #659.');
}

const canonicalOrder = normalizeSourceRows([
    { order_number: 2223, client_old_id: 70, total: 10320 },
    { order_number: 2223, client_old_id: 151, total: 10320 },
], 'order_number', {
    '2223': { match: { client_old_id: 70 } },
});
if (canonicalOrder.rejected.length !== 0
    || canonicalOrder.resolved.length !== 1
    || canonicalOrder.accepted[0].client_old_id !== 70) {
    throw new Error('La selección canónica no resolvió el pedido #2223.');
}

console.log('OK: los envíos compartidos se consolidan sin perder cargos y los conflictos reales se bloquean.');
