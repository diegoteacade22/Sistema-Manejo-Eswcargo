import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
    DrivePutOptions,
    DriveRequestClient,
    GoogleDriveDocumentStore,
    loadGoogleServiceAccountCredentials,
} from '../lib/document-cloud-drive';

const folderId = 'folder_1234567890';
const options: DrivePutOptions = {
    kind: 'INVOICE',
    identity: 'order:42',
    contentFingerprint: 'logical-v1',
};

function digest(contents: Uint8Array) {
    return createHash('sha256').update(contents).digest('hex');
}

function managedProperties({
    payloadSha256,
    contentFingerprint = options.contentFingerprint,
    identity = options.identity,
    kind = options.kind,
}: {
    payloadSha256: string;
    contentFingerprint?: string;
    identity?: string;
    kind?: DrivePutOptions['kind'];
}) {
    return {
        eswManaged: 'document-export-v1',
        eswKind: kind,
        eswIdentity: identity,
        eswContentFingerprint: contentFingerprint,
        eswPayloadSha256: payloadSha256,
    };
}

class FakeDriveClient implements DriveRequestClient {
    readonly calls: Array<Record<string, unknown>> = [];
    private readonly responses: unknown[];

    constructor(responses: unknown[]) {
        this.responses = [...responses];
    }

    async request<T>(requestOptions: Record<string, unknown>) {
        this.calls.push(requestOptions);
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

test('crea un artefacto administrado y exige readback de identidad, carpeta, tamaño y huellas', async () => {
    const contents = Buffer.from('pdf-controlado');
    const payloadSha256 = digest(contents);
    const client = new FakeDriveClient([
        { files: [] },
        { id: 'drive-file-abcdefgh' },
        {
            id: 'drive-file-abcdefgh',
            name: 'INV-CONTROL.pdf',
            size: String(contents.length),
            parents: [folderId],
            appProperties: managedProperties({ payloadSha256 }),
        },
    ]);
    const store = new GoogleDriveDocumentStore(client, folderId);

    const result = await store.put('INV-CONTROL.pdf', contents, 'application/pdf', options);

    assert.equal(result.action, 'CREATED');
    assert.equal(result.idSuffix, 'abcdefgh');
    assert.equal(client.calls[1]?.method, 'POST');
    assert.match(String((client.calls[1]?.headers as Record<string, string>)['Content-Type']), /^multipart\/related/);
    const multipart = client.calls[1]?.data as Buffer;
    const contentOffset = multipart.indexOf(contents);
    assert.ok(contentOffset > 4);
    assert.equal(multipart.subarray(contentOffset - 4, contentOffset).toString('hex'), '0d0a0d0a');
    assert.deepEqual(multipart.subarray(contentOffset, contentOffset + contents.length), contents);
    assert.match(multipart.toString('utf8'), /"eswIdentity":"order:42"/);
    assert.match(multipart.toString('utf8'), /"eswContentFingerprint":"logical-v1"/);
});

test('segunda corrida lógica idéntica queda UNCHANGED aunque el PDF regenere bytes volátiles', async () => {
    const storedContents = Buffer.from('pdf-con-CreationDate-anterior');
    const regeneratedContents = Buffer.from('pdf-con-CreationDate-nueva');
    assert.notEqual(digest(storedContents), digest(regeneratedContents));
    const existing = {
        id: 'drive-file-abcdefgh',
        name: 'INV-CONTROL.pdf',
        size: String(storedContents.length),
        parents: [folderId],
        appProperties: managedProperties({ payloadSha256: digest(storedContents) }),
    };
    const client = new FakeDriveClient([{ files: [existing] }, existing]);
    const store = new GoogleDriveDocumentStore(client, folderId);

    const result = await store.put('INV-CONTROL.pdf', regeneratedContents, 'application/pdf', options);

    assert.equal(result.action, 'UNCHANGED');
    assert.equal(result.sha256, digest(storedContents));
    assert.equal(result.size, storedContents.length);
    assert.equal(client.calls.length, 2);
    assert.equal(client.calls.some((call) => call.method === 'POST' || call.method === 'PATCH'), false);
});

test('falla cerrado ante una colisión por nombre que no pertenece al exportador', async () => {
    const unmanaged = {
        id: 'external-file-abcdefgh',
        name: 'INV-CONTROL.pdf',
        size: '99',
        parents: [folderId],
        appProperties: {},
    };
    const client = new FakeDriveClient([{ files: [unmanaged] }]);
    const store = new GoogleDriveDocumentStore(client, folderId);

    await assert.rejects(
        store.put('INV-CONTROL.pdf', Buffer.from('nuevo'), 'application/pdf', options),
        /colisión no administrada/,
    );
    assert.equal(client.calls.length, 1);
    assert.equal(client.calls.some((call) => call.method === 'POST' || call.method === 'PATCH'), false);
});

test('actualiza contenido in-place cuando cambia la huella lógica', async () => {
    const contents = Buffer.from('pdf-nuevo');
    const previous = {
        id: 'drive-file-abcdefgh',
        name: 'INV-CONTROL.pdf',
        size: '3',
        parents: [folderId],
        appProperties: managedProperties({
            payloadSha256: digest(Buffer.from('old')),
            contentFingerprint: 'logical-v0',
        }),
    };
    const readback = {
        ...previous,
        size: String(contents.length),
        appProperties: managedProperties({ payloadSha256: digest(contents) }),
    };
    const client = new FakeDriveClient([{ files: [previous] }, { id: previous.id }, readback]);
    const store = new GoogleDriveDocumentStore(client, folderId);

    const result = await store.put('INV-CONTROL.pdf', contents, 'application/pdf', options);

    assert.equal(result.action, 'UPDATED');
    assert.equal(client.calls[1]?.method, 'PATCH');
    assert.match(String(client.calls[1]?.url), /\/upload\/drive\/v3\/files\/drive-file-abcdefgh$/);
});

test('renombrar el número conserva la identidad inmutable y actualiza el mismo archivo', async () => {
    const contents = Buffer.from('pdf-regenerado');
    const renamedOptions = { ...options, contentFingerprint: 'logical-v2' };
    const existing = {
        id: 'drive-file-abcdefgh',
        name: 'INV-ANTERIOR.pdf',
        size: '16',
        parents: [folderId],
        appProperties: managedProperties({ payloadSha256: digest(Buffer.from('contenido-previo')) }),
    };
    const renamed = {
        ...existing,
        name: 'INV-NUEVO.pdf',
        size: String(contents.length),
        appProperties: managedProperties({
            payloadSha256: digest(contents),
            contentFingerprint: renamedOptions.contentFingerprint,
        }),
    };
    const client = new FakeDriveClient([{ files: [existing] }, { id: existing.id }, renamed]);
    const store = new GoogleDriveDocumentStore(client, folderId);

    const result = await store.put('INV-NUEVO.pdf', contents, 'application/pdf', renamedOptions);

    assert.equal(result.action, 'UPDATED');
    assert.equal(result.idSuffix, 'abcdefgh');
    assert.equal(client.calls[1]?.method, 'PATCH');
    assert.match(String(client.calls[1]?.url), /\/upload\/drive\/v3\/files\/drive-file-abcdefgh$/);
    assert.equal(client.calls.some((call) => call.method === 'POST'), false);

    const secondClient = new FakeDriveClient([{ files: [renamed] }, renamed]);
    const secondStore = new GoogleDriveDocumentStore(secondClient, folderId);
    const second = await secondStore.put('INV-NUEVO.pdf', Buffer.from('otro-pdf-volatil'), 'application/pdf', renamedOptions);
    assert.equal(second.action, 'UNCHANGED');
    assert.equal(secondClient.calls.some((call) => call.method === 'POST' || call.method === 'PATCH'), false);
});

test('falla cerrado ante identidades o nombres duplicados', async () => {
    const contents = Buffer.from('pdf-nuevo');
    const existing = {
        id: 'drive-file-abcdefgh',
        name: 'INV-CONTROL.pdf',
        size: '3',
        parents: [folderId],
        appProperties: managedProperties({ payloadSha256: digest(Buffer.from('old')) }),
    };
    const duplicateClient = new FakeDriveClient([{ files: [existing, { ...existing, id: 'otro' }] }]);
    const duplicateStore = new GoogleDriveDocumentStore(duplicateClient, folderId);
    await assert.rejects(
        duplicateStore.put('INV-CONTROL.pdf', contents, 'application/pdf', options),
        /más de un artefacto/,
    );
});
