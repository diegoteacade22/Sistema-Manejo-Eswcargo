export type SourceCollision<T> = {
    key: string;
    rows: T[];
};

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
        const uniqueRows = Array.from(new Map(group.map((row) => [JSON.stringify(row), row])).values());
        if (uniqueRows.length > 1) {
            rejected.push({ key, rows: uniqueRows });
        } else {
            accepted.push(uniqueRows[0]);
        }
    }
    return { accepted, rejected };
}
