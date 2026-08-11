import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();

test('browser print layout paginates invoice rows instead of clipping them', () => {
    const source = readFileSync(
        path.join(root, 'app/orders/[id]/invoice/invoice-template.tsx'),
        'utf8',
    );

    assert.match(source, /#invoice-content\s*\{[\s\S]*?height:\s*auto;/);
    assert.match(source, /#invoice-content\s*\{[\s\S]*?overflow:\s*visible\s*!important;/);
    assert.match(source, /\.invoice-items-table thead\s*\{\s*display:\s*table-header-group;/);
    assert.match(source, /\.invoice-items-table tr\s*\{[\s\S]*?break-inside:\s*avoid;/);
    assert.doesNotMatch(source, /^\s*height:\s*10\.65in;/m);
});

test('generated PDF layout does not force invoice content into one fixed-height flex page', () => {
    const source = readFileSync(path.join(root, 'app/email-actions.ts'), 'utf8');

    assert.match(source, /\.page\s*\{[^}]*min-height:\s*11in;[^}]*height:\s*auto;/);
    assert.match(source, /\.items thead\s*\{\s*display:\s*table-header-group;/);
    assert.match(source, /\.items tr\s*\{[^}]*break-inside:\s*avoid;/);
    assert.doesNotMatch(source, /\.page\s*\{\s*width:\s*8\.5in;\s*height:\s*11in;/);
});
