
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log("Cleaning up all existing transactions to ensure a fresh sync with Excel...");

    // Delete all transactions
    const result = await prisma.transaction.deleteMany({});

    console.log(`Deleted ${result.count} transactions.`);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
