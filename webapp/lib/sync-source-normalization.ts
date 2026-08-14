export type SourceCollision<T> = {
    key: string;
    rows: T[];
};

export type SharedShipmentHeader<T> = {
    key: string;
    rows: T[];
};

export type CanonicalSourceRule = {
    mode?: 'select' | 'shared' | 'single';
    match?: Record<string, unknown>;
    source?: string;
    reason?: string;
};

export type CanonicalSourceRules = Record<string, CanonicalSourceRule>;

export type ResolvedSourceCollision<T> = {
    key: string;
    rows: T[];
    selected: T;
    rule: CanonicalSourceRule;
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

const shipmentPhysicalFields = [
    'forwarder',
    'date_shipped',
    'date_arrived',
    'status',
] as const;

const shipmentAggregateFields = [
    'weight_fw',
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

function normalizedSharedWeightCli<T extends ShipmentSourceRow>(group: T[], fallback: unknown) {
    const weights = group.map((row) => ({
        client: numberOrZero(row.weight_cli),
        forwarder: numberOrZero(row.weight_fw),
    }));
    const allPlausible = weights.every(({ client, forwarder }) =>
        client <= Math.max(10, forwarder * 3),
    );
    return allPlausible
        ? weights.reduce((total, row) => total + row.client, 0)
        : numberOrZero(fallback);
}

function matchesCanonicalRule(row: Record<string, unknown>, rule?: CanonicalSourceRule) {
    const match = rule?.match;
    if (!match || Object.keys(match).length === 0) return false;
    return Object.entries(match).every(([field, expected]) => {
        const actual = row[field];
        if (typeof expected === 'number') return Number(actual) === expected;
        return String(actual ?? '') === String(expected ?? '');
    });
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
export function normalizeShipmentSourceRows<T extends ShipmentSourceRow>(
    rows: T[],
    canonicalRules: CanonicalSourceRules = {},
) {
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
    const resolved: ResolvedSourceCollision<T>[] = [];
    const freightRows: T[] = [];

    const appendFreightAllocations = (group: T[]) => {
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
    };

    for (const [key, sourceRows] of groups) {
        const group = uniqueRows(sourceRows);
        if (group.length === 1) {
            accepted.push(group[0]);
            freightRows.push(group[0]);
            continue;
        }

        const hasPhysicalConflict = shipmentPhysicalFields.some((field) => {
            const values = new Set(group.map((row) => JSON.stringify(row[field] ?? null)));
            return values.size > 1;
        });
        if (hasPhysicalConflict) {
            const rule = canonicalRules[key];
            const matches = group.filter((row) => matchesCanonicalRule(row, rule));
            if (matches.length === 1) {
                accepted.push(matches[0]);
                appendFreightAllocations(group);
                resolved.push({ key, rows: group, selected: matches[0], rule });
                continue;
            }
            rejected.push({ key, rows: group });
            continue;
        }

        // Preserve the historically selected display header (the last source row)
        // while summing every client allocation for the physical shipment.
        const aggregate = { ...group[group.length - 1], old_client_id: null, client_name_match: null } as T;
        for (const field of shipmentAggregateFields) {
            (aggregate as ShipmentSourceRow)[field] = group.reduce(
                (total, row) => total + numberOrZero(row[field]),
                0,
            );
        }
        aggregate.weight_cli = normalizedSharedWeightCli(group, aggregate.weight_cli);
        accepted.push(aggregate);
        shared.push({ key, rows: group });
        appendFreightAllocations(group);
    }

    return { accepted, rejected, shared, resolved, freightRows };
}

export function normalizeSourceRows<T extends Record<string, unknown>>(
    rows: T[],
    keyName: string,
    canonicalRules: CanonicalSourceRules = {},
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
    const resolved: ResolvedSourceCollision<T>[] = [];
    for (const [key, group] of groups) {
        const uniqueGroupRows = uniqueRows(group);
        if (uniqueGroupRows.length > 1) {
            const rule = canonicalRules[key];
            const matches = uniqueGroupRows.filter((row) => matchesCanonicalRule(row, rule));
            if (matches.length === 1) {
                accepted.push(matches[0]);
                resolved.push({ key, rows: uniqueGroupRows, selected: matches[0], rule });
            } else {
                rejected.push({ key, rows: uniqueGroupRows });
            }
        } else {
            accepted.push(uniqueGroupRows[0]);
        }
    }
    return { accepted, rejected, resolved };
}
