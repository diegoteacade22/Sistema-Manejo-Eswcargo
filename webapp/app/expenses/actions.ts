
'use server'

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';

export async function getExpenses() {
    return await prisma.expense.findMany({
        orderBy: { date: 'desc' }
    });
}

export async function createExpense(data: {
    date: Date,
    category: string,
    description: string,
    amount: number,
    businessUnit: string
}) {
    const expense = await prisma.expense.create({
        data
    });
    revalidatePath('/expenses');
    return expense;
}

export async function deleteExpense(id: number) {
    await prisma.expense.delete({ where: { id } });
    revalidatePath('/expenses');
}

export async function deleteAllExpenses() {
    await prisma.expense.deleteMany({});
    revalidatePath('/expenses');
}

export async function importExpensesFromCsv(csvText: string) {
    const lines = csvText.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return { success: false, error: "Archivo vacío o sin datos" };

    const expensesToStore: any[] = [];
    console.log(`🔍 Auditoría de Importación: ${lines.length} líneas detectadas.`);

    // 1. Detectar delimitador (Coma vs Punto y Coma)
    const firstLine = lines[0];
    const commaCount = (firstLine.match(/,/g) || []).length;
    const semiCount = (firstLine.match(/;/g) || []).length;
    const delimiter = semiCount > commaCount ? ';' : ',';
    console.log(`📡 Delimitador detectado: "${delimiter}"`);

    // 2. Procesar líneas
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();

        // Parser robusto
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

        // Salto si no hay suficientes columnas (necesitamos al menos G = índice 6)
        if (values.length < 7) continue;

        try {
            // A. VALIDACIÓN DE CATEGORÍA (Columna G = índice 6)
            const categoria = values[6] || '';
            const isESW = categoria.toUpperCase().includes('ESW');

            // Si no tiene categoría ESW, lo ignoramos (regla del negocio)
            if (!isESW) continue;

            // B. PARSING DE FECHA (Columna A = índice 0)
            let dateVal = values[0];
            let date: Date | null = null;

            if (dateVal.includes('/') || dateVal.includes('-')) {
                const sep = dateVal.includes('/') ? '/' : '-';
                const parts = dateVal.split(sep);
                if (parts.length === 3) {
                    let d = parseInt(parts[0]);
                    let m = parseInt(parts[1]);
                    let y = parseInt(parts[2]);

                    // Si el primer bloque tiene 4 dígitos, es YYYY/MM/DD
                    if (parts[0].length === 4) {
                        y = parseInt(parts[0]); m = parseInt(parts[1]); d = parseInt(parts[2]);
                    }
                    // Si el último bloque tiene 4 dígitos (DD/MM/YYYY o MM/DD/YYYY)
                    else if (parts[2].length === 4) {
                        y = parseInt(parts[2]);
                    }
                    // Manejo de año de 2 dígitos (YY)
                    else if (parts[2].length === 2) {
                        y = parseInt(parts[2]) + 2000;
                    }

                    // Disambiguate DD/MM vs MM/DD based on common values or just assume DD/MM
                    // For now, let's keep d, m, y and add a guard for logical months
                    if (m > 12 && d <= 12) { // Swap if month is > 12 (likely MM/DD)
                        [d, m] = [m, d];
                    }

                    // CONTROLADOR: Validar lógica de fecha (No puede ser > año actual + 1)
                    if (y < 2010 || y > new Date().getFullYear() + 1) {
                        console.warn(`⚠️ Omitiendo línea ${i}: Año inválido detectado (${y}).`);
                        continue;
                    }

                    date = new Date(y, m - 1, d);
                }
            } else {
                date = new Date(dateVal);
            }

            if (!date || isNaN(date.getTime())) continue;

            // C. PARSING DE MONTO (Columna D = índice 3)
            let rawAmount = values[3] || '0';
            let cleanAmount = rawAmount.replace(/[^0-9,.-]/g, '');
            if (cleanAmount.includes('.') && cleanAmount.includes(',')) {
                cleanAmount = cleanAmount.replace(/\./g, '').replace(',', '.');
            } else if (cleanAmount.includes(',')) {
                cleanAmount = cleanAmount.replace(',', '.');
            }

            const amount = parseFloat(cleanAmount);

            // CONTROLADOR: Validar monto razonable
            if (isNaN(amount) || Math.abs(amount) > 5000000 || rawAmount.toLowerCase().includes('e')) {
                continue;
            }

            // D. DESCRIPCIÓN (Columna C = índice 2)
            const description = values[2] || 'Sin descripción';

            expensesToStore.push({
                date,
                category: categoria,
                description,
                amount: Math.abs(amount),
                businessUnit: 'GENERAL'
            });

        } catch (error) {
            // Error silencioso por línea
        }
    }

    if (expensesToStore.length > 0) {
        try {
            await prisma.expense.createMany({
                data: expensesToStore,
                skipDuplicates: true
            });
            revalidatePath('/expenses');
            revalidatePath('/analytics/financial');
            return { success: true, count: expensesToStore.length };
        } catch (e: any) {
            return { success: false, error: e.message };
        }
    }

    return { success: true, count: 0, message: "No se encontraron datos válidos con el filtro 'ESW'" };
}
