
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
    const expensesToStore: any[] = [];

    console.log(`Iniciando importación masiva. Total líneas: ${lines.length}`);

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        // Parser robusto para CSV
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

        // Filtro G (índice 6)
        if (values.length < 7) continue;
        const categoria = values[6] || '';
        if (!categoria.toUpperCase().includes('ESW')) continue;

        try {
            // 1. Fecha (A)
            let dateVal = values[0];
            let date: Date;
            if (dateVal.includes('/')) {
                const parts = dateVal.split('/');
                if (parts[0].length === 4) {
                    date = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
                } else {
                    date = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
                }
            } else {
                date = new Date(dateVal);
            }

            if (isNaN(date.getTime())) continue;

            // 2. Monto (D = índice 3)
            let rawAmount = values[3] || '0';
            let cleanAmount = rawAmount.replace(/[^0-9,.-]/g, '');
            if (cleanAmount.includes('.') && cleanAmount.includes(',')) {
                cleanAmount = cleanAmount.replace(/\./g, '').replace(',', '.');
            } else if (cleanAmount.includes(',')) {
                cleanAmount = cleanAmount.replace(',', '.');
            }

            const amount = parseFloat(cleanAmount);

            // VALIDACIÓN CRÍTICA: Ignorar si el monto parece un número de tarjeta o referencia larga 
            // (Si es un número entero de más de 10 dígitos, probablemente no es un monto de gasto real)
            if (isNaN(amount) || (Number.isInteger(amount) && String(Math.abs(amount)).length > 10)) {
                console.log(`Línea ${i}: Omitiendo monto sospechoso/inválido: ${rawAmount}`);
                continue;
            }

            // 3. Descripción (C = índice 2)
            const description = values[2] || 'Sin descripción';

            expensesToStore.push({
                date,
                category: categoria,
                description,
                amount: Math.abs(amount),
                businessUnit: 'GENERAL'
            });
        } catch (e) {
            // Ignorar líneas corruptas en modo masivo para no frenar el proceso
        }
    }

    if (expensesToStore.length > 0) {
        // Inserción atómica masiva (Bases de datos optimizan esto internamente)
        await prisma.expense.createMany({
            data: expensesToStore
        });
    }

    console.log(`Importación finalizada. Éxito: ${expensesToStore.length}`);
    revalidatePath('/expenses');
    revalidatePath('/analytics/financial');
    return { success: true, count: expensesToStore.length };
}
