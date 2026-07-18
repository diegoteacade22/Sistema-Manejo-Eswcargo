export type SourceCollision<T> = {
    key: string;
    rows: T[];
};

export type SharedShipmentHeader<T> = {
    key: string;
    rows: T[];
};

type ShipmentSourceRow = Record<string, unknown> & {
    shipment_number?: number | string | null;
    old_client_id?: number | null;
    client_name_match?: string | null;
    forwarder?: string | null;
    date_shipped?: string | null;
    date_arrived?: string | null;
    type_load?: string | null;
    status?: string | null;
    notes?: string | null;
    weight_fw?: number | null;
    weight_cli?: number | null;
    price_total?: number | null;
    cost_total?: number | null;
    profit?: number | null;
};

const shipmentOperationalFields = [
    'forwarder',
    'date_shipped',
    'date_arrived',
    'type_load',
    'status',
    'notes',
] as const;

const shipmentAggregateFields = [
    'weight_fw',
    'weight_cli',
    'price_total',
    'cost_total',
    'profit',
] as const;

function uniqueRows<T>(rows: T[]) {
    return Array.from(new Map(rows.map((row) => [JSON.stringify(row), row])).values());
}

function numberOrZero(value: unknown) {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : 0;
}

function shipmentAllocationKey(row: ShipmentSourceRow) {
    return [
        row.shipment_number ?? '',
        row.old_client_id ?? '',
        String(row.client_name_match || '').trim().toUpperCase(),
        row.date_shipped ?? '',
    ].join('|');
}

// A shipment can have several source rows when one physical departure contains
// allocations for different clients. Aggregate only if the operational header is
// identical; client-level freight remains separate for ledger reconciliation.
export function normalizeShipmentSourceRows<T extends ShipmentSourceRow>(rows: T[]) {
    const groups = new Map<string, T[]>();
    for (const row of rows) {
        const key = row.shipment_number;
        if (key === null || key === undefined || key === '') continue;
        const normalizedKey = String(key);
        const group = groups.get(normalizedKey) || [];
        group.push(row);
        groups.set(normalizedKey, group);
    }

    const accepted: T[] = [];
    const rejected: SourceCollision<T>[] = [];
    const shared: SharedShipmentHeader<T>[] = [];
    const freightRows: T[] = [];

    for (const [key, sourceRows] of groups) {
        const group = uniqueRows(sourceRows);
        if (group.length === 1) {
            accepted.push(group[0]);
            freightRows.push(group[0]);
            continue;
        }

        const hasOperationalConflict = shipmentOperationalFields.some((field) => {
            const values = new Set(group.map((row) => JSON.stringify(row[field] ?? null)));
            return values.size > 1;
        });
        if (hasOperationalConflict) {
            rejected.push({ key, rows: group });
            continue;
        }

        const aggregate = { ...group[0], old_client_id: null, client_name_match: null } as T;
        for (const field of shipmentAggregateFields) {
            (aggregate as ShipmentSourceRow)[field] = group.reduce(
                (total, row) => total + numberOrZero(row[field]),
                0,
            );
        }
        accepted.push(aggregate);
        shared.push({ key, rows: group });

        const allocations = new Map<string, T[]>();
        for (const row of group) {
            const allocationKey = shipmentAllocationKey(row);
            const allocationRows = allocations.get(allocationKey) || [];
            allocationRows.push(row);
            allocations.set(allocationKey, allocationRows);
        }
        for (const allocationRows of allocations.values()) {
            const allocation = { ...allocationRows[0] } as T;
            for (const field of shipmentAggregateFields) {
                (allocation as ShipmentSourceRow)[field] = allocationRows.reduce(
                    (total, row) => total + numberOrZero(row[field]),
                    0,
                );
            }
            freightRows.push(allocation);
        }
    }

    return { accepted, rejected, shared, freightRows };
}

export function normalizeSourceRows<T extends Record<string, unknown>>(
    rows: T[],
    keyName: string,
) {
    const groups = new Map<string, T[]>();
    for (const row of rows) {
        const key = row[keyName];
        if (key === null || key === undefined || key === '') continue;
        const normalizedKey = String(key);
        const group = groups.get(normalizedKey) || [];
        group.push(row);
        groups.set(normalizedKey, group);
    }

    const accepted: T[] = [];
    const rejected: SourceCollision<T>[] = [];
    for (const [key, group] of groups) {
        const uniqueGroupRows = uniqueRows(group);
        if (uniqueGroupRows.length > 1) {
            rejected.push({ key, rows: uniqueGroupRows });
        } else {
            accepted.push(uniqueGroupRows[0]);
        }
    }
    return { accepted, rejected };
}
