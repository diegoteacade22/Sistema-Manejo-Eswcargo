
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    const lastPayment = await prisma.transaction.findFirst({
        where: {
            clientId: 162,
            type: 'PAGO',
            reference: { startsWith: 'Order #' }
        },
        orderBy: { date: 'desc' }
    });

    console.log('Último pago automático registrado:');
    if (lastPayment) {
        console.log(`  Fecha: ${lastPayment.date.toLocaleDateString()}`);
        console.log(`  Monto: $${lastPayment.amount}`);
        console.log(`  Referencia: ${lastPayment.reference}`);
        console.log(`  Descripción: ${lastPayment.description}`);
    } else {
        console.log('  No se encontraron pagos automáticos');
    }
}

main().finally(() => prisma.$disconnect());
