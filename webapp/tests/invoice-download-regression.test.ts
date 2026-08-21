import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();

test('invoice PDF se descarga desde una ruta autenticada y no desde filesystem de Vercel', () => {
    const template = fs.readFileSync(path.join(root, 'app/orders/[id]/invoice/invoice-template.tsx'), 'utf8');
    const route = fs.readFileSync(path.join(root, 'app/api/orders/[id]/invoice/route.ts'), 'utf8');

    assert.match(template, /fetch\(`\/api\/orders\/\$\{order\.id\}\/invoice`\)/);
    assert.doesNotMatch(template, /saveInvoicePdfToDrive/);
    assert.match(route, /await auth\(\)/);
    assert.match(route, /content-disposition/);
});

test('packing list PDF se descarga desde una ruta autenticada y no crea carpetas en Vercel', () => {
    const template = fs.readFileSync(path.join(root, 'app/shipments/[id]/packing-list/packing-list-template.tsx'), 'utf8');
    const route = fs.readFileSync(path.join(root, 'app/api/shipments/[id]/packing-list/route.ts'), 'utf8');

    assert.match(template, /fetch\(`\/api\/shipments\/\$\{shipment\.id\}\/packing-list/);
    assert.doesNotMatch(template, /savePackingListPdfToDrive/);
    assert.match(route, /await auth\(\)/);
    assert.match(route, /content-disposition/);
});

test('invoice resume unidades reales y el buscador acepta INV o numeral', () => {
    const template = fs.readFileSync(path.join(root, 'app/orders/[id]/invoice/invoice-template.tsx'), 'utf8');
    const generator = fs.readFileSync(path.join(root, 'app/email-actions.ts'), 'utf8');
    const ordersPage = fs.readFileSync(path.join(root, 'app/orders/page.tsx'), 'utf8');

    assert.match(template, /const totalPcs = items\.reduce/);
    assert.match(template, /\{totalPcs\} PCS/);
    assert.match(generator, /\$\{totalPcs\} PCS/);
    assert.match(ordersPage, /inv\(\?:oice\)\?/);
});
