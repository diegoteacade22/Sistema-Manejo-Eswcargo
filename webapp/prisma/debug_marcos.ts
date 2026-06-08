
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const client = await prisma.client.findFirst({
        where: { name: { contains: 'Marcos Roku' } }
    });

    if (!client) {
        console.log("Client not found.");
        return;
    }

    console.log(`Checking Client: ${client.name} (ID: ${client.id})`);

    const txs = await prisma.transaction.findMany({
        where: { clientId: client.id },
        orderBy: { date: 'asc' }
    });

    let balance = 0;
    let cargoCount = 0;
    let pagoCount = 0;

    console.log(`\n--- Transaction History ---`);
    for (const tx of txs) {
        balance += tx.amount;
        if (tx.amount > 0) cargoCount++;
        else pagoCount++;

        // Print condensed log
        // console.log(`${tx.date.toISOString().split('T')[0]} | ${tx.type} | $${tx.amount} | Ref: ${tx.reference}`);
    }

    console.log(`\n--- Summary ---`);
    console.log(`Total Transactions: ${txs.length}`);
    console.log(`Cargos: ${cargoCount}`);
    console.log(`Pagos: ${pagoCount}`);
    console.log(`Final Calculated Balance: $${balance.toFixed(2)}`);

    // Sample first few
    console.log(`\n--- Sample First 5 ---`);
    txs.slice(0, 5).forEach(tx => console.log(`${tx.type}: $${tx.amount} (${tx.reference})`));
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
