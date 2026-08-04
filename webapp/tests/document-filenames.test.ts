import assert from 'node:assert/strict';
import test from 'node:test';
import { getInvoicePdfFileName, getPackingPdfFileName } from '@/lib/document-filenames';

test('invoice usa numero y codigo de cliente', () => {
    assert.equal(getInvoicePdfFileName(2558, 99, 70, 7), 'INV-2558-70.pdf');
});

test('packing usa numero de envio y codigo de cliente', () => {
    assert.equal(getPackingPdfFileName(1237, 88, 119, 1), 'PL-1237-119.pdf');
});

test('usa ids como respaldo y limpia caracteres no seguros', () => {
    assert.equal(getInvoicePdfFileName(null, 99, 'C 7/AR', 7), 'INV-99-C-7-AR.pdf');
});
