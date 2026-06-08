
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    const client = await prisma.client.findUnique({
        where: { id: 162 },
        include: { transactions: true }
    });

    if (!client) {
        console.log('Cliente 162 no encontrado');
        return;
    }

    console.log(`\n=== MARCOS ROKU (ID: 162) ===\n`);

    // Calcular totales
    const cargos = client.transactions.filter(t => t.type === 'CARGO');
    const pagos = client.transactions.filter(t => t.type === 'PAGO');

    const totalCargos = cargos.reduce((sum, t) => sum + t.amount, 0);
    const totalPagos = pagos.reduce((sum, t) => sum + t.amount, 0);
    const saldoFinal = totalCargos + totalPagos;

    console.log(`Total Transacciones: ${client.transactions.length}`);
    console.log(`  - Cargos: ${cargos.length} transacciones`);
    console.log(`  - Pagos: ${pagos.length} transacciones\n`);

    console.log(`Total Cargos (Deuda): ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(totalCargos)}`);
    console.log(`Total Pagos (Crédito): ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(totalPagos)}`);
    console.log(`\n🎯 SALDO FINAL: ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(saldoFinal)}\n`);

    // Desglose por tipo de referencia
    const byRef = {
        orders: client.transactions.filter(t => t.reference?.startsWith('Order #')),
        shipments: client.transactions.filter(t => t.reference?.startsWith('Envío #')),
        manual: client.transactions.filter(t => t.reference?.startsWith('Manual-')),
        extra: client.transactions.filter(t => t.reference?.startsWith('PagoExtra-'))
    };

    console.log(`Desglose por origen:`);
    console.log(`  - Pedidos (Order #): ${byRef.orders.length} txs`);
    console.log(`  - Envíos (Envío #): ${byRef.shipments.length} txs`);
    console.log(`  - Manuales (Manual-): ${byRef.manual.length} txs`);
    console.log(`  - Extras (PagoExtra-): ${byRef.extra.length} txs\n`);

    // Últimas 5 transacciones
    const last5 = client.transactions.sort((a, b) => b.date.getTime() - a.date.getTime()).slice(0, 5);
    console.log(`Últimas 5 transacciones:`);
    last5.forEach(t => {
        const sign = t.amount > 0 ? '+' : '';
        console.log(`  ${t.date.toLocaleDateString()} | ${t.type.padEnd(5)} | ${sign}${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(t.amount).padStart(12)} | ${t.description}`);
    });
}

main().finally(() => prisma.$disconnect());
