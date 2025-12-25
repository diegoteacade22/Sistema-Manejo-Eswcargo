
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log("Checking Top Debtors in DB...");

    // Group by Client
    const clientBalances = await prisma.transaction.groupBy({
        by: ['clientId'],
        _sum: { amount: true },
        having: { amount: { _sum: { gt: 1 } } },
        orderBy: { _sum: { amount: 'desc' } },
        take: 10
    });

    console.log(`Found ${clientBalances.length} clients with debt > 1`);

    for (const b of clientBalances) {
        const client = await prisma.client.findUnique({ where: { id: b.clientId } });
        console.log(`\nClient: ${client?.name} (ID: ${b.clientId}) - Balance: $${b._sum.amount?.toFixed(2)}`);

        // Show transactions
        const txs = await prisma.transaction.findMany({
            where: { clientId: b.clientId },
            take: 20,
            orderBy: { date: 'desc' }
        });

        console.table(txs.map(t => ({
            id: t.id,
            date: t.date.toISOString().split('T')[0],
            type: t.type,
            amount: t.amount,
            ref: t.reference
        })));
    }
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
