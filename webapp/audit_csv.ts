
function auditLine(line: string) {
    // 1. Detect Delimiter
    const commaCount = (line.match(/,/g) || []).length;
    const semiCount = (line.match(/;/g) || []).length;
    const delimiter = semiCount > commaCount ? ';' : ',';

    // 2. Robust Split
    const values: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let j = 0; j < line.length; j++) {
        const char = line[j];
        if (char === '"') inQuotes = !inQuotes;
        else if (char === delimiter && !inQuotes) {
            values.push(current.trim().replace(/^"|"$/g, ''));
            current = '';
        } else current += char;
    }
    values.push(current.trim().replace(/^"|"$/g, ''));

    // 3. Date Parsing Audit
    let date: Date | null = null;
    let dateError = '';
    const dateVal = values[0];
    if (dateVal) {
        if (dateVal.includes('/') || dateVal.includes('-')) {
            const separator = dateVal.includes('/') ? '/' : '-';
            const parts = dateVal.split(separator);
            if (parts.length === 3) {
                // Try to identify year, month, day
                let y = 0, m = 0, d = 0;
                if (parts[0].length === 4) { // YYYY/MM/DD
                    y = parseInt(parts[0]); m = parseInt(parts[1]); d = parseInt(parts[2]);
                } else if (parts[2].length === 4 || parts[2].length === 2) { // DD/MM/YYYY or MM/DD/YYYY
                    y = parseInt(parts[2]);
                    if (y < 100) y += 2000; // Handle YY
                    // Need to disambiguate DD/MM vs MM/DD
                    // Let's assume DD/MM for now as it's common in Spanish
                    d = parseInt(parts[0]); m = parseInt(parts[1]);
                }
                date = new Date(y, m - 1, d);
            }
        }
    }

    return {
        delimiter,
        values,
        parsedDate: date?.toLocaleDateString('es-ES'),
        year: date?.getFullYear(),
        month: date ? date.getMonth() + 1 : null,
        description: values[2],
        category: values[6]
    };
}

const lines = [
    "3/4/2027,ESW-AMAZON,April,123.45,,ESW-AMAZON", // Simulated problem line
    "10/7/2023;ESW-AMAZON;October;50.00;;;ESW-AMAZON" // Semicolon case
];

console.table(lines.map(auditLine));
