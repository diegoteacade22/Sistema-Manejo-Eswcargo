import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { GoogleAuth } from 'google-auth-library';

export const DOCUMENT_EXPORT_STATE_FILE = '.eswcargo-document-export-state.v1.json';

export type DocumentExportState = {
    version: 1;
    orders: Record<string, string>;
    shipments: Record<string, string>;
    updatedAt: string;
};

type DriveFile = {
    id: string;
    name: string;
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
        data?: Buffer | string;
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

function escapeDriveQuery(value: string) {
    return value.replaceAll('\\', '\\\\').replaceAll("'", "\\'");
}

function shortId(value: string) {
    return value.slice(-8);
}

function sha256(contents: Uint8Array) {
    return createHash('sha256').update(contents).digest('hex');
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

    private async listByName(name: string) {
        const response = await this.client.request<DriveListResponse>({
            url: 'https://www.googleapis.com/drive/v3/files',
            method: 'GET',
            params: {
                q: `'${escapeDriveQuery(this.folderId)}' in parents and name = '${escapeDriveQuery(name)}' and trashed = false`,
                fields: 'files(id,name,size,md5Checksum,modifiedTime,parents,appProperties)',
                pageSize: 2,
                supportsAllDrives: 'true',
                includeItemsFromAllDrives: 'true',
            },
        });
        return response.data.files ?? [];
    }

    private async readback(fileId: string) {
        const response = await this.client.request<DriveFile>({
            url: `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`,
            method: 'GET',
            params: {
                fields: 'id,name,size,md5Checksum,modifiedTime,parents,appProperties',
                supportsAllDrives: 'true',
            },
        });
        return response.data;
    }

    private result(action: DrivePutResult['action'], file: DriveFile, name: string, size: number, digest: string): DrivePutResult {
        if (file.name !== name || !file.parents?.includes(this.folderId)) {
            throw new Error(`Drive no confirmó nombre y carpeta para ${name}.`);
        }
        if (file.appProperties?.eswSha256 !== digest || Number(file.size) !== size) {
            throw new Error(`Drive no confirmó tamaño y huella para ${name}.`);
        }
        return {
            action,
            idSuffix: shortId(file.id),
            name,
            size,
            sha256: digest,
            modifiedTime: file.modifiedTime,
        };
    }

    async put(name: string, contents: Uint8Array, mimeType: string, kind: string): Promise<DrivePutResult> {
        if (!name || name.includes('/') || name.includes('\\')) {
            throw new Error('Nombre de artefacto Drive inválido.');
        }
        const digest = sha256(contents);
        const existing = await this.listByName(name);
        if (existing.length > 1) {
            throw new Error(`Drive contiene más de un artefacto activo con el nombre ${name}.`);
        }
        if (existing[0]?.appProperties?.eswSha256 === digest && Number(existing[0].size) === contents.byteLength) {
            return this.result('UNCHANGED', await this.readback(existing[0].id), name, contents.byteLength, digest);
        }

        const boundary = `eswcargo_${createHash('sha256').update(`${name}:${digest}`).digest('hex').slice(0, 24)}`;
        const metadata = {
            name,
            ...(existing.length === 0 ? { parents: [this.folderId] } : {}),
            appProperties: {
                eswManaged: 'document-export-v1',
                eswKind: kind,
                eswSha256: digest,
            },
        };
        const data = multipartBody(metadata, contents, mimeType, boundary);
        const response = await this.client.request<DriveFile>({
            url: existing[0]
                ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(existing[0].id)}`
                : 'https://www.googleapis.com/upload/drive/v3/files',
            method: existing[0] ? 'PATCH' : 'POST',
            params: {
                uploadType: 'multipart',
                fields: 'id,name,size,md5Checksum,modifiedTime,parents,appProperties',
                supportsAllDrives: 'true',
            },
            headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
            data,
        });
        const readback = await this.readback(response.data.id);
        return this.result(existing[0] ? 'UPDATED' : 'CREATED', readback, name, contents.byteLength, digest);
    }

    async loadState(): Promise<DocumentExportState | null> {
        const matches = await this.listByName(DOCUMENT_EXPORT_STATE_FILE);
        if (matches.length > 1) {
            throw new Error('Drive contiene más de un manifiesto de estado del exportador.');
        }
        if (!matches[0]) return null;
        const response = await this.client.request<string | DocumentExportState>({
            url: `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(matches[0].id)}`,
            method: 'GET',
            params: { alt: 'media', supportsAllDrives: 'true' },
        });
        const parsed = typeof response.data === 'string'
            ? JSON.parse(response.data) as DocumentExportState
            : response.data;
        if (parsed.version !== 1 || typeof parsed.orders !== 'object' || typeof parsed.shipments !== 'object') {
            throw new Error('El manifiesto Drive del exportador tiene formato inválido.');
        }
        return parsed;
    }

    async saveState(state: DocumentExportState) {
        return this.put(
            DOCUMENT_EXPORT_STATE_FILE,
            Buffer.from(JSON.stringify(state, null, 2)),
            'application/json',
            'STATE',
        );
    }

    async probe() {
        const response = await this.client.request<DriveListResponse>({
            url: 'https://www.googleapis.com/drive/v3/files',
            method: 'GET',
            params: {
                q: `'${escapeDriveQuery(this.folderId)}' in parents and trashed = false`,
                fields: 'files(id,name,size,modifiedTime,parents,appProperties)',
                orderBy: 'modifiedTime desc',
                pageSize: 10,
                supportsAllDrives: 'true',
                includeItemsFromAllDrives: 'true',
            },
        });
        const files = response.data.files ?? [];
        const artifact = files.find((file) => file.name.endsWith('.pdf')) ?? files[0];
        const readback = artifact ? await this.readback(artifact.id) : null;
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
