import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
    DOCUMENT_EXPORT_STATE_FILE,
    DrivePutOptions,
    DriveRequestClient,
    GoogleDriveDocumentStore,
    loadGoogleServiceAccountCredentials,
} from '../lib/document-cloud-drive';
import {
    INVOICE_DOCUMENT_RENDER_VERSION,
    invoiceDocumentContentFingerprint,
} from '../lib/document-export-fingerprint';

const folderId = 'folder_1234567890';
const options: DrivePutOptions = {
    kind: 'INVOICE',
    identity: 'order:42',
    contentFingerprint: 'logical-v1',
};

function sha256(contents: Uint8Array) {
    return createHash('sha256').update(contents).digest('hex');
}

function md5(contents: Uint8Array) {
    return createHash('md5').update(contents).digest('hex');
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

function driveFile({
    contents,
    name = 'INV-CONTROL.pdf',
    fileOptions = options,
}: {
    contents: Uint8Array;
    name?: string;
    fileOptions?: DrivePutOptions;
}) {
    return {
        id: 'drive-file-abcdefgh',
        name,
        mimeType: fileOptions.kind === 'STATE' ? 'application/json' : 'application/pdf',
        size: String(contents.byteLength),
        md5Checksum: md5(contents),
        parents: [folderId],
        appProperties: managedProperties({
            payloadSha256: sha256(contents),
            contentFingerprint: fileOptions.contentFingerprint,
            identity: fileOptions.identity,
            kind: fileOptions.kind,
        }),
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

const invoiceSource = {
    id: 42,
    order_number: 7001,
    date: '2026-08-27T00:00:00.000Z',
    total_amount: 1250,
    client: {
        id: 9,
        old_id: 300,
        name: 'Cliente fixture',
        address: 'Dirección fixture',
        city: 'Miami',
        country: 'USA',
    },
    shipment: { weight_cli: 2.5 },
    items: [{
        id: 80,
        productName: 'Producto fixture',
        quantity: 2,
        unit_price: 625,
        status: 'CONFIRMED',
        product: { color_grade: 'BLACK' },
    }],
};

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

test('crea y verifica MIME, tamaño, MD5 y SHA-256 contra los bytes reales', async () => {
    const contents = Buffer.from('pdf-controlado');
    const readback = driveFile({ contents });
    const client = new FakeDriveClient([
        { files: [] },
        { id: readback.id },
        readback,
        contents,
    ]);
    const store = new GoogleDriveDocumentStore(client, folderId);

    const result = await store.put('INV-CONTROL.pdf', contents, 'application/pdf', options);

    assert.equal(result.action, 'CREATED');
    assert.equal(result.idSuffix, 'abcdefgh');
    assert.equal(result.sha256, sha256(contents));
    assert.equal(client.calls[1]?.method, 'POST');
    assert.equal(client.calls[3]?.responseType, 'arraybuffer');
    const multipart = client.calls[1]?.data as Buffer;
    const contentOffset = multipart.indexOf(contents);
    assert.ok(contentOffset > 4);
    assert.equal(multipart.subarray(contentOffset - 4, contentOffset).toString('hex'), '0d0a0d0a');
    assert.deepEqual(multipart.subarray(contentOffset, contentOffset + contents.length), contents);
});

test('CREATED y UPDATED también fallan si el readback real no coincide', async () => {
    const createdContents = Buffer.from('pdf-creado');
    const createdReadback = { ...driveFile({ contents: createdContents }), mimeType: 'text/plain' };
    const createClient = new FakeDriveClient([
        { files: [] },
        { id: createdReadback.id },
        createdReadback,
        createdContents,
    ]);
    await assert.rejects(
        new GoogleDriveDocumentStore(createClient, folderId).put(
            'INV-CONTROL.pdf',
            createdContents,
            'application/pdf',
            options,
        ),
        /MIME application\/pdf/,
    );

    const nextOptions = { ...options, contentFingerprint: 'logical-v2' };
    const previous = driveFile({ contents: Buffer.from('pdf-previo') });
    const updatedContents = Buffer.from('pdf-actualizado');
    const updatedReadback = {
        ...driveFile({ contents: updatedContents, fileOptions: nextOptions }),
        md5Checksum: 'md5-stale',
    };
    const updateClient = new FakeDriveClient([
        { files: [previous] },
        { id: previous.id },
        updatedReadback,
        updatedContents,
    ]);
    await assert.rejects(
        new GoogleDriveDocumentStore(updateClient, folderId).put(
            'INV-CONTROL.pdf',
            updatedContents,
            'application/pdf',
            nextOptions,
        ),
        /MD5 real/,
    );
    assert.equal(updateClient.calls[1]?.method, 'PATCH');
});

test('segunda corrida lógica idéntica verifica el PDF almacenado y queda UNCHANGED', async () => {
    const storedContents = Buffer.from('pdf-con-CreationDate-anterior');
    const regeneratedContents = Buffer.from('pdf-con-CreationDate-nueva');
    assert.notEqual(sha256(storedContents), sha256(regeneratedContents));
    const existing = driveFile({ contents: storedContents });
    const client = new FakeDriveClient([{ files: [existing] }, existing, storedContents]);
    const store = new GoogleDriveDocumentStore(client, folderId);

    const result = await store.put('INV-CONTROL.pdf', regeneratedContents, 'application/pdf', options);

    assert.equal(result.action, 'UNCHANGED');
    assert.equal(result.sha256, sha256(storedContents));
    assert.equal(result.size, storedContents.length);
    assert.equal(client.calls.length, 3);
    assert.equal(client.calls.some((call) => call.method === 'POST' || call.method === 'PATCH'), false);
});

for (const corruptReadback of [
    {
        name: 'MIME incorrecto',
        change: (file: ReturnType<typeof driveFile>) => ({ ...file, mimeType: 'text/plain' }),
        error: /MIME application\/pdf/,
    },
    {
        name: 'tamaño 999',
        change: (file: ReturnType<typeof driveFile>) => ({ ...file, size: '999' }),
        error: /tamaño válido/,
    },
    {
        name: 'MD5 inválido',
        change: (file: ReturnType<typeof driveFile>) => ({ ...file, md5Checksum: 'md5-invalido' }),
        error: /MD5 real/,
    },
    {
        name: 'SHA-256 stale',
        change: (file: ReturnType<typeof driveFile>) => ({
            ...file,
            appProperties: { ...file.appProperties, eswPayloadSha256: sha256(Buffer.from('otro-payload')) },
        }),
        error: /SHA-256 real/,
    },
]) {
    test(`UNCHANGED falla cerrado con ${corruptReadback.name}`, async () => {
        const storedContents = Buffer.from('pdf-real-almacenado');
        const metadata = corruptReadback.change(driveFile({ contents: storedContents }));
        const client = new FakeDriveClient([{ files: [metadata] }, metadata, storedContents]);
        const store = new GoogleDriveDocumentStore(client, folderId);

        await assert.rejects(
            store.put('INV-CONTROL.pdf', Buffer.from('pdf-regenerado'), 'application/pdf', options),
            corruptReadback.error,
        );
        assert.equal(client.calls.some((call) => call.method === 'POST' || call.method === 'PATCH'), false);
    });
}

test('falla cerrado ante una colisión por nombre que no pertenece al exportador', async () => {
    const unmanaged = {
        id: 'external-file-abcdefgh',
        name: 'INV-CONTROL.pdf',
        mimeType: 'application/pdf',
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

async function assertFingerprintUpdatesSameFile(
    previousFingerprint: string,
    nextFingerprint: string,
    nextContents: Buffer,
) {
    assert.notEqual(previousFingerprint, nextFingerprint);
    const previousOptions = { ...options, contentFingerprint: previousFingerprint };
    const nextOptions = { ...options, contentFingerprint: nextFingerprint };
    const previous = driveFile({ contents: Buffer.from('pdf-anterior'), fileOptions: previousOptions });
    const readback = driveFile({ contents: nextContents, fileOptions: nextOptions });
    const client = new FakeDriveClient([{ files: [previous] }, { id: previous.id }, readback, nextContents]);
    const store = new GoogleDriveDocumentStore(client, folderId);

    const result = await store.put('INV-CONTROL.pdf', nextContents, 'application/pdf', nextOptions);

    assert.equal(result.action, 'UPDATED');
    assert.equal(result.idSuffix, 'abcdefgh');
    assert.equal(client.calls[1]?.method, 'PATCH');
    assert.match(String(client.calls[1]?.url), /\/upload\/drive\/v3\/files\/drive-file-abcdefgh$/);
    assert.equal(client.calls.some((call) => call.method === 'POST'), false);
}

test('cambio de weight_cli cambia la huella y actualiza el mismo file ID', async () => {
    const previousFingerprint = invoiceDocumentContentFingerprint(invoiceSource);
    const nextFingerprint = invoiceDocumentContentFingerprint({
        ...invoiceSource,
        shipment: { weight_cli: 3.75 },
    });
    await assertFingerprintUpdatesSameFile(previousFingerprint, nextFingerprint, Buffer.from('pdf-nuevo-peso'));
});

test('cambio de render version cambia la huella y actualiza el mismo file ID', async () => {
    const previousFingerprint = invoiceDocumentContentFingerprint(invoiceSource);
    const nextFingerprint = invoiceDocumentContentFingerprint(
        invoiceSource,
        `${INVOICE_DOCUMENT_RENDER_VERSION}-next`,
    );
    await assertFingerprintUpdatesSameFile(previousFingerprint, nextFingerprint, Buffer.from('pdf-nuevo-template'));
});

test('renombrar el número conserva identidad y actualiza el mismo archivo', async () => {
    const contents = Buffer.from('pdf-regenerado');
    const renamedOptions = { ...options, contentFingerprint: 'logical-v2' };
    const existing = driveFile({
        contents: Buffer.from('contenido-previo'),
        name: 'INV-ANTERIOR.pdf',
    });
    const renamed = driveFile({ contents, name: 'INV-NUEVO.pdf', fileOptions: renamedOptions });
    const client = new FakeDriveClient([{ files: [existing] }, { id: existing.id }, renamed, contents]);
    const store = new GoogleDriveDocumentStore(client, folderId);

    const result = await store.put('INV-NUEVO.pdf', contents, 'application/pdf', renamedOptions);

    assert.equal(result.action, 'UPDATED');
    assert.equal(result.idSuffix, 'abcdefgh');
    assert.equal(client.calls[1]?.method, 'PATCH');
    assert.match(String(client.calls[1]?.url), /\/upload\/drive\/v3\/files\/drive-file-abcdefgh$/);
    assert.equal(client.calls.some((call) => call.method === 'POST'), false);
});

test('manifiesto de estado también exige MIME, tamaño y hashes reales antes de usarlo', async () => {
    const state = { version: 1 as const, orders: { '42': 'abc' }, shipments: {}, updatedAt: '2026-08-27T00:00:00.000Z' };
    const contents = Buffer.from(JSON.stringify(state));
    const stateOptions: DrivePutOptions = {
        kind: 'STATE',
        identity: 'state:v1',
        contentFingerprint: sha256(contents),
    };
    const manifest = driveFile({ contents, name: DOCUMENT_EXPORT_STATE_FILE, fileOptions: stateOptions });
    const client = new FakeDriveClient([{ files: [manifest] }, manifest, contents]);
    const store = new GoogleDriveDocumentStore(client, folderId);

    assert.deepEqual(await store.loadState(), state);

    const staleManifest = {
        ...manifest,
        appProperties: { ...manifest.appProperties, eswPayloadSha256: sha256(Buffer.from('stale')) },
    };
    const staleClient = new FakeDriveClient([{ files: [staleManifest] }, staleManifest, contents]);
    await assert.rejects(
        new GoogleDriveDocumentStore(staleClient, folderId).loadState(),
        /SHA-256 real/,
    );

    const malformedContents = Buffer.from(JSON.stringify({ version: 1, orders: null, shipments: {} }));
    const malformedOptions = { ...stateOptions, contentFingerprint: sha256(malformedContents) };
    const malformedManifest = driveFile({
        contents: malformedContents,
        name: DOCUMENT_EXPORT_STATE_FILE,
        fileOptions: malformedOptions,
    });
    const malformedClient = new FakeDriveClient([
        { files: [malformedManifest] },
        malformedManifest,
        malformedContents,
    ]);
    await assert.rejects(
        new GoogleDriveDocumentStore(malformedClient, folderId).loadState(),
        /formato inválido/,
    );
});

test('falla cerrado ante identidades o nombres duplicados', async () => {
    const existing = driveFile({ contents: Buffer.from('pdf-previo') });
    const duplicateClient = new FakeDriveClient([{ files: [existing, { ...existing, id: 'otro' }] }]);
    const duplicateStore = new GoogleDriveDocumentStore(duplicateClient, folderId);
    await assert.rejects(
        duplicateStore.put('INV-CONTROL.pdf', Buffer.from('pdf-nuevo'), 'application/pdf', options),
        /más de un artefacto/,
    );
});
