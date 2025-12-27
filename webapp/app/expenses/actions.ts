
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
    const lines = csvText.split(/\r?\n/);
    let count = 0;

    console.log(`Iniciando importación. Total líneas: ${lines.length}`);

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        // Parser robusto para CSV (manejando comas dentro de comillas)
        const values: string[] = [];
        let current = '';
        let inQuotes = false;
        for (let j = 0; j < line.length; j++) {
            const char = line[j];
            if (char === '"') inQuotes = !inQuotes;
            else if (char === ',' && !inQuotes) {
                values.push(current.trim().replace(/^"|"$/g, ''));
                current = '';
            } else current += char;
        }
        values.push(current.trim().replace(/^"|"$/g, ''));

        // Necesitamos al menos 7 columnas para llegar a la G (índice 6)
        if (values.length < 7) continue;

        const categoria = values[6] || '';
        if (!categoria.toUpperCase().includes('ESW')) continue;

        try {
            // 1. Parsing de Fecha (A)
            let dateVal = values[0];
            let date: Date;
            if (dateVal.includes('/')) {
                const parts = dateVal.split('/');
                if (parts[0].length === 4) date = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
                else date = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
            } else date = new Date(dateVal);

            if (isNaN(date.getTime())) continue;

            console.log(`Procesando línea ${i}: Fecha=${date.toISOString()}, Cat=${categoria}`);

            // 2. Parsing de Monto (D = índice 3)
            let rawAmount = values[3] || '0';
            let cleanAmount = rawAmount.replace(/[^0-9,.-]/g, '');

            // Normalización de separadores
            if (cleanAmount.includes('.') && cleanAmount.includes(',')) {
                // Formato con ambos: assumir . para miles y , para decimal
                cleanAmount = cleanAmount.replace(/\./g, '').replace(',', '.');
            } else if (cleanAmount.includes(',')) {
                // Solo coma: tratar como decimal
                cleanAmount = cleanAmount.replace(',', '.');
            }

            const amount = parseFloat(cleanAmount);
            if (isNaN(amount)) {
                console.log(`Línea ${i}: Monto inválido (${rawAmount})`);
                continue;
            }

            // 3. Descripción (C = índice 2)
            const description = values[2] || 'Sin descripción';

            await prisma.expense.create({
                data: {
                    date: date,
                    category: categoria,
                    description: description,
                    amount: Math.abs(amount),
                    businessUnit: 'GENERAL'
                }
            });
            count++;
        } catch (e) {
            console.error(`Error procesando línea ${i}:`, e);
        }
    }

    console.log(`Importación finalizada. Éxito: ${count}`);
    revalidatePath('/expenses');
    revalidatePath('/analytics/financial');
    return { success: true, count };
}
