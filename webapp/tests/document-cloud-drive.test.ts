import assert from 'node:assert/strict';
import test from 'node:test';
import {
    DriveRequestClient,
    GoogleDriveDocumentStore,
    loadGoogleServiceAccountCredentials,
} from '../lib/document-cloud-drive';

const folderId = 'folder_1234567890';

class FakeDriveClient implements DriveRequestClient {
    readonly calls: Array<Record<string, unknown>> = [];
    private readonly responses: unknown[];

    constructor(responses: unknown[]) {
        this.responses = [...responses];
    }

    async request<T>(options: Record<string, unknown>) {
        this.calls.push(options);
        if (this.responses.length === 0) throw new Error('Fake sin respuesta configurada.');
        return { data: this.responses.shift() as T };
    }
}

test('valida credenciales sin exponer su contenido', async () => {
    const credentials = await loadGoogleServiceAccountCredentials({
        GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({
            type: 'service_account',
            client_email: 'runner@example.invalid',
            private_key: ['fixture', 'PRIVATE', 'KEY'].join(' '),
        }),
    });
    assert.equal(credentials.type, 'service_account');
    await assert.rejects(
        loadGoogleServiceAccountCredentials({ GOOGLE_SERVICE_ACCOUNT_JSON: '{bad' }),
        /JSON válido/,
    );
});

test('crea por nombre estable y exige readback de carpeta, tamaño y huella', async () => {
    const contents = Buffer.from('pdf-controlado');
    const digest = '70e7ca58a91d485fb6c783df00804bbd1e442e177ba3898a7c01e4e0fb5d4cbe';
    const client = new FakeDriveClient([
        { files: [] },
        { id: 'drive-file-abcdefgh' },
        {
            id: 'drive-file-abcdefgh',
            name: 'INV-CONTROL.pdf',
            size: String(contents.length),
            parents: [folderId],
            appProperties: { eswSha256: digest },
        },
    ]);
    const store = new GoogleDriveDocumentStore(client, folderId);

    const result = await store.put('INV-CONTROL.pdf', contents, 'application/pdf', 'INVOICE');

    assert.equal(result.action, 'CREATED');
    assert.equal(result.idSuffix, 'abcdefgh');
    assert.equal(client.calls[1]?.method, 'POST');
    assert.match(String((client.calls[1]?.headers as Record<string, string>)['Content-Type']), /^multipart\/related/);
    const multipart = client.calls[1]?.data as Buffer;
    const contentOffset = multipart.indexOf(contents);
    assert.ok(contentOffset > 4);
    assert.equal(multipart.subarray(contentOffset - 4, contentOffset).toString('hex'), '0d0a0d0a');
    assert.deepEqual(multipart.subarray(contentOffset, contentOffset + contents.length), contents);
});

test('segunda corrida con la misma huella no vuelve a escribir', async () => {
    const contents = Buffer.from('pdf-controlado');
    const digest = '70e7ca58a91d485fb6c783df00804bbd1e442e177ba3898a7c01e4e0fb5d4cbe';
    const existing = {
        id: 'drive-file-abcdefgh',
        name: 'INV-CONTROL.pdf',
        size: String(contents.length),
        parents: [folderId],
        appProperties: { eswSha256: digest },
    };
    const client = new FakeDriveClient([{ files: [existing] }, existing]);
    const store = new GoogleDriveDocumentStore(client, folderId);

    const result = await store.put('INV-CONTROL.pdf', contents, 'application/pdf', 'INVOICE');

    assert.equal(result.action, 'UNCHANGED');
    assert.equal(client.calls.length, 2);
    assert.equal(client.calls.some((call) => call.method === 'POST' || call.method === 'PATCH'), false);
});

test('actualiza in-place cuando cambia la huella y falla cerrado ante duplicados', async () => {
    const contents = Buffer.from('pdf-nuevo');
    const digest = '49e787685027f33bc417555af59c95d84630bf0f502522f5d1f56fedafe98cb1';
    const previous = {
        id: 'drive-file-abcdefgh',
        name: 'INV-CONTROL.pdf',
        size: '3',
        parents: [folderId],
        appProperties: { eswSha256: 'anterior' },
    };
    const readback = {
        ...previous,
        size: String(contents.length),
        appProperties: { eswSha256: digest },
    };
    const client = new FakeDriveClient([{ files: [previous] }, { id: previous.id }, readback]);
    const store = new GoogleDriveDocumentStore(client, folderId);

    const result = await store.put('INV-CONTROL.pdf', contents, 'application/pdf', 'INVOICE');

    assert.equal(result.action, 'UPDATED');
    assert.equal(client.calls[1]?.method, 'PATCH');

    const duplicateClient = new FakeDriveClient([{ files: [previous, { ...previous, id: 'otro' }] }]);
    const duplicateStore = new GoogleDriveDocumentStore(duplicateClient, folderId);
    await assert.rejects(
        duplicateStore.put('INV-CONTROL.pdf', contents, 'application/pdf', 'INVOICE'),
        /más de un artefacto/,
    );
});
