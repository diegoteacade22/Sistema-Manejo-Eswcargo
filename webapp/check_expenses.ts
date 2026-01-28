
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function check() {
    const expenses = await prisma.expense.findMany({
        orderBy: { amount: 'desc' },
        take: 10
    });
    console.log("Top 10 Expenses:");
    console.log(JSON.stringify(expenses, null, 2));

    const total = await prisma.expense.aggregate({
        _sum: { amount: true }
    });
    console.log("Total Expenses:", total._sum.amount);
}

check();
