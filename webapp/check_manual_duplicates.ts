
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    // Pagos manuales que intentamos cargar
    const manualPayments = [
        { date: '2026-01-15', amount: 16500 },
        { date: '2026-01-19', amount: 9500 },
        { date: '2026-01-20', amount: 12500 },
        { date: '2026-01-22', amount: 8326 },
        { date: '2026-01-23', amount: 7175 },
        { date: '2026-01-24', amount: 4980 },
        { date: '2026-01-24', amount: 5489 },
        { date: '2026-01-26', amount: 472 },
        { date: '2026-01-29', amount: 5870 }
    ];

    console.log('=== VERIFICANDO DUPLICADOS ===\n');

    for (const mp of manualPayments) {
        // Buscar pagos automáticos (sin "Manual-") con la misma fecha y monto
        const existing = await prisma.transaction.findMany({
            where: {
                clientId: 162,
                type: 'PAGO',
                date: {
                    gte: new Date(mp.date + 'T00:00:00'),
                    lt: new Date(mp.date + 'T23:59:59')
                },
                amount: mp.amount,
                NOT: {
                    reference: { startsWith: 'Manual-' }
                }
            }
        });

        if (existing.length > 0) {
            console.log(`❌ DUPLICADO: ${mp.date} - $${mp.amount}`);
            existing.forEach(e => {
                console.log(`   Ya existe: ID ${e.id} | "${e.description}" | Ref: "${e.reference || 'SIN REF'}"`);
            });
        } else {
            console.log(`✅ ÚNICO: ${mp.date} - $${mp.amount}`);
        }
    }
}

main().finally(() => prisma.$disconnect());
