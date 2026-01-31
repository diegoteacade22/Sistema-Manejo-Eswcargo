
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const clientId = 214; // Luca Sta Fe Nahuel
    const transactions = await prisma.transaction.findMany({
        where: { clientId },
        orderBy: { date: 'asc' }
    });

    console.log(`Transactions for Client ID ${clientId}:`);
    let balance = 0;
    transactions.forEach(tx => {
        balance += tx.amount;
        console.log(`Date: ${tx.date.toISOString().split('T')[0]} | Type: ${tx.type} | Amount: ${tx.amount.toFixed(2).padStart(10)} | Balance: ${balance.toFixed(2).padStart(10)} | Ref: ${tx.reference} | Desc: ${tx.description}`);
    });
}

main()
    .catch(e => console.error(e))
    .finally(() => prisma.$disconnect());
