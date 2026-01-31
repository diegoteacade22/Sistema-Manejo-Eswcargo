
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    const txs = await prisma.transaction.findMany({
        where: { clientId: 162, type: 'PAGO' },
        orderBy: { date: 'desc' }
    });

    console.log(`\nTotal de PAGOS: ${txs.length}\n`);

    // Buscar duplicados por monto y fecha
    const grouped = new Map();
    txs.forEach(t => {
        const key = `${t.date.toISOString().split('T')[0]}-${t.amount}`;
        if (!grouped.has(key)) {
            grouped.set(key, []);
        }
        grouped.get(key).push(t);
    });

    console.log('=== PAGOS DUPLICADOS (misma fecha y monto) ===\n');
    let foundDuplicates = false;
    grouped.forEach((txList, key) => {
        if (txList.length > 1) {
            foundDuplicates = true;
            console.log(`\n📍 ${key}:`);
            txList.forEach((t: any) => {
                console.log(`  ID: ${t.id} | $${t.amount} | ${t.description} | Ref: ${t.reference}`);
            });
        }
    });

    if (!foundDuplicates) {
        console.log('No se encontraron duplicados exactos.\n');
    }

    // Mostrar todos los pagos del 19/01/2026
    console.log('\n=== PAGOS DEL 19/01/2026 ===\n');
    const jan19 = txs.filter(t => t.date.toISOString().startsWith('2026-01-19'));
    jan19.forEach(t => {
        console.log(`ID: ${t.id} | $${t.amount} | ${t.description} | Ref: ${t.reference}`);
    });

    // Sumar total
    const total = txs.reduce((sum, t) => sum + t.amount, 0);
    console.log(`\n💰 TOTAL DE TODOS LOS PAGOS: $${total.toFixed(2)}`);
}

main().finally(() => prisma.$disconnect());
