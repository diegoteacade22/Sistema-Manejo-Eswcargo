import { normalizeSourceRows } from '../lib/sync-source-normalization';

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
