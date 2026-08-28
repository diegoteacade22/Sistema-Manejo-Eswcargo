import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { GoogleAuth } from 'google-auth-library';

export const DOCUMENT_EXPORT_STATE_FILE = '.eswcargo-document-export-state.v1.json';

export type DocumentExportArtifactKind = 'INVOICE' | 'PACKING_LIST';

export type DocumentExportPilot = {
    completed: true;
    kind: 'INVOICE';
    identity: string;
    name: string;
    contentFingerprint: string;
    payloadSha256: string;
    size: number;
    completedAt: string;
};

export type DocumentExportState = {
    version: 1;
    orders: Record<string, string>;
    shipments: Record<string, string>;
    updatedAt: string;
    pilotCompleted?: DocumentExportPilot;
};

type DriveFile = {
    id: string;
    name: string;
    mimeType?: string;
    size?: string;
    md5Checksum?: string;
    modifiedTime?: string;
    parents?: string[];
    appProperties?: Record<string, string>;
};

type DriveListResponse = { files?: DriveFile[] };

export type DriveRequestClient = {
    request<T>(options: {
        url: string;
        method?: string;
        params?: Record<string, string | number>;
        headers?: Record<string, string>;
        data?: Buffer | string | Record<string, unknown>;
        responseType?: 'arraybuffer';
    }): Promise<{ data: T }>;
};

export type DrivePutResult = {
    action: 'CREATED' | 'UPDATED' | 'UNCHANGED';
    idSuffix: string;
    name: string;
    size: number;
    sha256: string;
    modifiedTime?: string;
};

export type DrivePutOptions = {
    kind: DocumentExportArtifactKind | 'STATE';
    identity: string;
    contentFingerprint: string;
};

const MANAGED_VALUE = 'document-export-v1';

function escapeDriveQuery(value: string) {
    return value.replaceAll('\\', '\\\\').replaceAll("'", "\\'");
}

function shortId(value: string) {
    return value.slice(-8);
}

function sha256(contents: Uint8Array) {
    return createHash('sha256').update(contents).digest('hex');
}

function md5(contents: Uint8Array) {
    return createHash('md5').update(contents).digest('hex');
}

function asBuffer(contents: Buffer | Uint8Array | ArrayBuffer | string) {
    if (Buffer.isBuffer(contents)) return contents;
    if (contents instanceof ArrayBuffer) return Buffer.from(contents);
    if (contents instanceof Uint8Array) return Buffer.from(contents);
    return Buffer.from(contents);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value)
        && typeof value === 'object'
        && !Array.isArray(value)
        && Object.getPrototypeOf(value) === Object.prototype;
}

function isCanonicalIso(value: unknown): value is string {
    if (typeof value !== 'string') return false;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function isFingerprintMap(value: unknown, keyPattern: RegExp): value is Record<string, string> {
    return isPlainObject(value)
        && Object.entries(value).every(([key, fingerprint]) => (
            keyPattern.test(key)
            && typeof fingerprint === 'string'
            && /^[a-f0-9]{64}$/.test(fingerprint)
        ));
}

function assertDriveState(state: unknown): asserts state is DocumentExportState {
    if (!isPlainObject(state)
        || state.version !== 1
        || !isCanonicalIso(state.updatedAt)
        || !isFingerprintMap(state.orders, /^[1-9]\d*$/)
        || !isFingerprintMap(state.shipments, /^[1-9]\d*(?::[1-9]\d*)?$/)) {
        throw new Error('El manifiesto Drive del exportador tiene formato inválido.');
    }
    if (state.pilotCompleted === undefined) return;
    if (!isPlainObject(state.pilotCompleted)
        || state.pilotCompleted.completed !== true
        || !isCanonicalIso(state.pilotCompleted.completedAt)
        || state.pilotCompleted.kind !== 'INVOICE'
        || typeof state.pilotCompleted.identity !== 'string'
        || typeof state.pilotCompleted.name !== 'string'
        || !state.pilotCompleted.name
        || !state.pilotCompleted.name.toLowerCase().endsWith('.pdf')
        || state.pilotCompleted.name.includes('/')
        || state.pilotCompleted.name.includes('\\')
        || typeof state.pilotCompleted.contentFingerprint !== 'string'
        || !/^[a-f0-9]{64}$/.test(state.pilotCompleted.contentFingerprint)
        || typeof state.pilotCompleted.payloadSha256 !== 'string'
        || !/^[a-f0-9]{64}$/.test(state.pilotCompleted.payloadSha256)
        || typeof state.pilotCompleted.size !== 'number'
        || !Number.isSafeInteger(state.pilotCompleted.size)
        || state.pilotCompleted.size <= 0) {
        throw new Error('El manifiesto Drive del exportador tiene formato inválido.');
    }

    const identityMatch = state.pilotCompleted.identity.match(/^order:([1-9]\d*)$/);
    const pilotKey = identityMatch?.[1];
    if (!pilotKey || state.orders[pilotKey] !== state.pilotCompleted.contentFingerprint) {
        throw new Error('El manifiesto Drive no contiene una prueba de piloto válida.');
    }
}

function assertFolderId(value: string | undefined) {
    const folderId = value?.trim();
    if (!folderId || !/^[A-Za-z0-9_-]{10,}$/.test(folderId)) {
        throw new Error('Falta ESW_DOCUMENT_EXPORT_DRIVE_FOLDER_ID o su formato no es válido.');
    }
    return folderId;
}

export async function loadGoogleServiceAccountCredentials(env: Record<string, string | undefined> = process.env) {
    const credentialsPath = env.GOOGLE_CREDENTIALS_FILE?.trim();
    const encoded = env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64?.trim();
    const inline = env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
    const raw = credentialsPath
        ? await readFile(credentialsPath, 'utf8')
        : encoded
            ? Buffer.from(encoded, 'base64').toString('utf8')
            : inline;

    if (!raw) {
        throw new Error('Faltan credenciales Google por archivo, JSON o JSON base64.');
    }

    let parsed: Record<string, unknown>;
    try {
        parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
        throw new Error('Las credenciales Google no contienen JSON válido.');
    }

    if (parsed.type !== 'service_account'
        || typeof parsed.client_email !== 'string'
        || !parsed.client_email.includes('@')
        || typeof parsed.private_key !== 'string'
        || !parsed.private_key.includes('PRIVATE KEY')) {
        throw new Error('Las credenciales Google no tienen formato service_account válido.');
    }

    return parsed;
}

export async function createGoogleDriveRequestClient(env: Record<string, string | undefined> = process.env): Promise<DriveRequestClient> {
    const credentials = await loadGoogleServiceAccountCredentials(env);
    const auth = new GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/drive'],
    });
    return await auth.getClient() as unknown as DriveRequestClient;
}

function multipartBody(metadata: Record<string, unknown>, contents: Uint8Array, mimeType: string, boundary: string) {
    const prefix = Buffer.from([
        `--${boundary}`,
        'Content-Type: application/json; charset=UTF-8',
        '',
        JSON.stringify(metadata),
        `--${boundary}`,
        `Content-Type: ${mimeType}`,
        '',
        '',
    ].join('\r\n'));
    const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);
    return Buffer.concat([prefix, Buffer.from(contents), suffix]);
}

export class GoogleDriveDocumentStore {
    private readonly client: DriveRequestClient;
    private readonly folderId: string;

    constructor(client: DriveRequestClient, folderId: string) {
        this.client = client;
        this.folderId = assertFolderId(folderId);
    }

    static async fromEnvironment(env: Record<string, string | undefined> = process.env) {
        const folderId = assertFolderId(env.ESW_DOCUMENT_EXPORT_DRIVE_FOLDER_ID);
        const client = await createGoogleDriveRequestClient(env);
        return new GoogleDriveDocumentStore(client, folderId);
    }

    private async listCandidates(name: string, identity: string) {
        const response = await this.client.request<DriveListResponse>({
            url: 'https://www.googleapis.com/drive/v3/files',
            method: 'GET',
            params: {
                q: `'${escapeDriveQuery(this.folderId)}' in parents and trashed = false and (name = '${escapeDriveQuery(name)}' or appProperties has { key='eswIdentity' and value='${escapeDriveQuery(identity)}' })`,
                fields: 'files(id,name,mimeType,size,md5Checksum,modifiedTime,parents,appProperties)',
                pageSize: 100,
                supportsAllDrives: 'true',
                includeItemsFromAllDrives: 'true',
            },
        });
        return response.data.files ?? [];
    }

    async verifyPilot(pilot: DocumentExportPilot): Promise<DrivePutResult> {
        const options: DrivePutOptions = {
            kind: pilot.kind,
            identity: pilot.identity,
            contentFingerprint: pilot.contentFingerprint,
        };
        const existing = await this.resolveExisting(pilot.name, options);
        if (!existing) throw new Error(`Drive no contiene el artefacto piloto ${pilot.identity}.`);
        const readback = await this.readbackArtifact(existing.id);
        return this.result(
            'UNCHANGED',
            readback.file,
            readback.contents,
            pilot.name,
            'application/pdf',
            options,
            pilot.payloadSha256,
            pilot.size,
        );
    }

    private async resolveExisting(name: string, options: DrivePutOptions) {
        const candidates = await this.listCandidates(name, options.identity);
        const identityMatches = candidates.filter((file) => file.appProperties?.eswIdentity === options.identity);
        const nameMatches = candidates.filter((file) => file.name === name);
        if (identityMatches.length > 1) {
            throw new Error(`Drive contiene más de un artefacto administrado para ${options.identity}.`);
        }
        if (nameMatches.length > 1) {
            throw new Error(`Drive contiene más de un artefacto activo con el nombre ${name}.`);
        }
        if (identityMatches[0] && nameMatches[0] && identityMatches[0].id !== nameMatches[0].id) {
            throw new Error(`Drive contiene una colisión entre identidad y nombre para ${options.identity}.`);
        }
        const existing = identityMatches[0] ?? nameMatches[0] ?? null;
        if (!existing) return null;
        if (existing.appProperties?.eswManaged !== MANAGED_VALUE
            || existing.appProperties?.eswKind !== options.kind
            || existing.appProperties?.eswIdentity !== options.identity) {
            throw new Error(`Drive contiene una colisión no administrada para ${name}.`);
        }
        return existing;
    }

    private async readbackMetadata(fileId: string) {
        const response = await this.client.request<DriveFile>({
            url: `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`,
            method: 'GET',
            params: {
                fields: 'id,name,mimeType,size,md5Checksum,modifiedTime,parents,appProperties',
                supportsAllDrives: 'true',
            },
        });
        return response.data;
    }

    private async readbackContents(fileId: string) {
        const response = await this.client.request<Buffer | Uint8Array | ArrayBuffer | string>({
            url: `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`,
            method: 'GET',
            params: { alt: 'media', supportsAllDrives: 'true' },
            responseType: 'arraybuffer',
        });
        return asBuffer(response.data);
    }

    private async readbackArtifact(fileId: string) {
        const file = await this.readbackMetadata(fileId);
        const contents = await this.readbackContents(fileId);
        return { file, contents };
    }

    private result(
        action: DrivePutResult['action'],
        file: DriveFile,
        contents: Uint8Array,
        name: string,
        mimeType: string,
        options: DrivePutOptions,
        expectedPayloadSha256?: string,
        expectedSize?: number,
    ): DrivePutResult {
        if (file.name !== name || !file.parents?.includes(this.folderId)) {
            throw new Error(`Drive no confirmó nombre y carpeta para ${name}.`);
        }
        if (file.mimeType !== mimeType) {
            throw new Error(`Drive no confirmó el MIME ${mimeType} para ${name}.`);
        }
        if (file.appProperties?.eswManaged !== MANAGED_VALUE
            || file.appProperties?.eswKind !== options.kind
            || file.appProperties?.eswIdentity !== options.identity
            || file.appProperties?.eswContentFingerprint !== options.contentFingerprint) {
            throw new Error(`Drive no confirmó identidad y huella lógica para ${name}.`);
        }
        const actualSha256 = sha256(contents);
        const declaredSha256 = file.appProperties?.eswPayloadSha256;
        if (!declaredSha256 || !/^[a-f0-9]{64}$/.test(declaredSha256) || declaredSha256 !== actualSha256) {
            throw new Error(`Drive no confirmó el SHA-256 real para ${name}.`);
        }
        const storedSize = Number(file.size);
        if (!Number.isSafeInteger(storedSize) || storedSize < 0 || storedSize !== contents.byteLength) {
            throw new Error(`Drive no confirmó un tamaño válido para ${name}.`);
        }
        const actualMd5 = md5(contents);
        if (!file.md5Checksum
            || !/^[a-f0-9]{32}$/.test(file.md5Checksum)
            || file.md5Checksum !== actualMd5) {
            throw new Error(`Drive no confirmó el MD5 real para ${name}.`);
        }
        if ((expectedPayloadSha256 && actualSha256 !== expectedPayloadSha256)
            || (expectedSize !== undefined && storedSize !== expectedSize)) {
            throw new Error(`Drive no confirmó tamaño y huella de bytes para ${name}.`);
        }
        return {
            action,
            idSuffix: shortId(file.id),
            name,
            size: storedSize,
            sha256: actualSha256,
            modifiedTime: file.modifiedTime,
        };
    }

    async put(name: string, contents: Uint8Array, mimeType: string, options: DrivePutOptions): Promise<DrivePutResult> {
        if (!name || name.includes('/') || name.includes('\\')) {
            throw new Error('Nombre de artefacto Drive inválido.');
        }
        if (!options.identity || !options.contentFingerprint) {
            throw new Error('Identidad y huella lógica son obligatorias para Drive.');
        }
        const payloadSha256 = sha256(contents);
        const existing = await this.resolveExisting(name, options);
        if (existing?.appProperties?.eswContentFingerprint === options.contentFingerprint) {
            if (existing.name === name) {
                const readback = await this.readbackArtifact(existing.id);
                return this.result('UNCHANGED', readback.file, readback.contents, name, mimeType, options);
            }
            const previousReadback = await this.readbackArtifact(existing.id);
            this.result('UNCHANGED', previousReadback.file, previousReadback.contents, existing.name, mimeType, options);
            await this.client.request<DriveFile>({
                url: `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(existing.id)}`,
                method: 'PATCH',
                params: {
                    fields: 'id,name,mimeType,size,md5Checksum,modifiedTime,parents,appProperties',
                    supportsAllDrives: 'true',
                },
                headers: { 'Content-Type': 'application/json' },
                data: { name },
            });
            const renamedReadback = await this.readbackArtifact(existing.id);
            return this.result('UPDATED', renamedReadback.file, renamedReadback.contents, name, mimeType, options);
        }

        const boundary = `eswcargo_${createHash('sha256').update(`${name}:${payloadSha256}`).digest('hex').slice(0, 24)}`;
        const metadata = {
            name,
            ...(!existing ? { parents: [this.folderId] } : {}),
            appProperties: {
                eswManaged: MANAGED_VALUE,
                eswKind: options.kind,
                eswIdentity: options.identity,
                eswContentFingerprint: options.contentFingerprint,
                eswPayloadSha256: payloadSha256,
            },
        };
        const data = multipartBody(metadata, contents, mimeType, boundary);
        const response = await this.client.request<DriveFile>({
            url: existing
                ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(existing.id)}`
                : 'https://www.googleapis.com/upload/drive/v3/files',
            method: existing ? 'PATCH' : 'POST',
            params: {
                uploadType: 'multipart',
                fields: 'id,name,mimeType,size,md5Checksum,modifiedTime,parents,appProperties',
                supportsAllDrives: 'true',
            },
            headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
            data,
        });
        const readback = await this.readbackArtifact(response.data.id);
        return this.result(
            existing ? 'UPDATED' : 'CREATED',
            readback.file,
            readback.contents,
            name,
            mimeType,
            options,
            payloadSha256,
            contents.byteLength,
        );
    }

    async loadState(): Promise<DocumentExportState | null> {
        const stateOptions: DrivePutOptions = {
            kind: 'STATE',
            identity: 'state:v1',
            contentFingerprint: 'state-read',
        };
        const existing = await this.resolveExisting(DOCUMENT_EXPORT_STATE_FILE, stateOptions);
        if (!existing) return null;
        const readback = await this.readbackArtifact(existing.id);
        const verifiedOptions = { ...stateOptions, contentFingerprint: sha256(readback.contents) };
        this.result(
            'UNCHANGED',
            readback.file,
            readback.contents,
            DOCUMENT_EXPORT_STATE_FILE,
            'application/json',
            verifiedOptions,
        );
        const parsed = JSON.parse(readback.contents.toString('utf8')) as unknown;
        assertDriveState(parsed);
        return parsed;
    }

    async saveState(state: DocumentExportState) {
        assertDriveState(state);
        if (!state.pilotCompleted) {
            throw new Error('Drive no guarda estado sin una prueba de piloto verificada.');
        }
        const contents = Buffer.from(JSON.stringify(state, null, 2));
        return this.put(
            DOCUMENT_EXPORT_STATE_FILE,
            contents,
            'application/json',
            {
                kind: 'STATE',
                identity: 'state:v1',
                contentFingerprint: sha256(contents),
            },
        );
    }

    async probe() {
        const response = await this.client.request<DriveListResponse>({
            url: 'https://www.googleapis.com/drive/v3/files',
            method: 'GET',
            params: {
                q: `'${escapeDriveQuery(this.folderId)}' in parents and trashed = false`,
                fields: 'files(id,name,mimeType,size,md5Checksum,modifiedTime,parents,appProperties)',
                orderBy: 'modifiedTime desc',
                pageSize: 10,
                supportsAllDrives: 'true',
                includeItemsFromAllDrives: 'true',
            },
        });
        const files = response.data.files ?? [];
        const artifact = files.find((file) => file.name.endsWith('.pdf')) ?? files[0];
        const readback = artifact ? await this.readbackMetadata(artifact.id) : null;
        return {
            folderAccessible: true,
            visibleArtifacts: files.length,
            artifactReadback: readback ? {
                idSuffix: shortId(readback.id),
                kind: readback.name.endsWith('.pdf') ? 'PDF' : 'STATE',
                nameHash: createHash('sha256').update(readback.name).digest('hex').slice(0, 12),
                size: Number(readback.size || 0),
                modifiedTime: readback.modifiedTime,
            } : null,
        };
    }
}
