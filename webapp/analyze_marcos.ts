
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    const client = await prisma.client.findUnique({
        where: { id: 162 },
        include: {
            transactions: {
                orderBy: { date: 'asc' }
            }
        }
    });

    if (!client) {
        console.log('Cliente no encontrado');
        return;
    }

    console.log('\n=== ANÁLISIS DETALLADO DE TRANSACCIONES ===\n');

    // Separar por tipo de referencia
    const orderTxs = client.transactions.filter(t => t.reference?.startsWith('Order #'));
    const shipmentTxs = client.transactions.filter(t => t.reference?.startsWith('Envío #'));
    const manualTxs = client.transactions.filter(t => t.reference?.startsWith('Manual-'));

    console.log('PEDIDOS (Order #):');
    const orderCargos = orderTxs.filter(t => t.type === 'CARGO');
    const orderPagos = orderTxs.filter(t => t.type === 'PAGO');
    console.log(`  Cargos: ${orderCargos.length} txs = ${orderCargos.reduce((s, t) => s + t.amount, 0)}`);
    console.log(`  Pagos: ${orderPagos.length} txs = ${orderPagos.reduce((s, t) => s + t.amount, 0)}`);

    console.log('\nENVÍOS (Envío #):');
    const shipCargos = shipmentTxs.filter(t => t.type === 'CARGO');
    console.log(`  Cargos: ${shipCargos.length} txs = ${shipCargos.reduce((s, t) => s + t.amount, 0)}`);

    console.log('\nMANUALES (Manual-):');
    const manualPagos = manualTxs.filter(t => t.type === 'PAGO');
    console.log(`  Pagos: ${manualPagos.length} txs = ${manualPagos.reduce((s, t) => s + t.amount, 0)}`);

    console.log('\n=== TOTALES ===');
    const totalCompras = orderCargos.reduce((s, t) => s + t.amount, 0);
    const totalPagosAuto = orderPagos.reduce((s, t) => s + t.amount, 0);
    const totalPagosManual = manualPagos.reduce((s, t) => s + t.amount, 0);
    const totalFletes = shipCargos.reduce((s, t) => s + t.amount, 0);

    console.log(`Total Compras: $${Math.abs(totalCompras).toFixed(2)}`);
    console.log(`Total Pagos (Auto): $${totalPagosAuto.toFixed(2)}`);
    console.log(`Total Pagos (Manual): $${totalPagosManual.toFixed(2)}`);
    console.log(`Total Pagos (SUMA): $${(totalPagosAuto + totalPagosManual).toFixed(2)}`);
    console.log(`Total Fletes: $${Math.abs(totalFletes).toFixed(2)}`);

    console.log('\n=== CÁLCULO FINAL ===');
    const saldo = totalCompras + totalPagosAuto + totalPagosManual + totalFletes;
    console.log(`Saldo = (${totalCompras}) + ${totalPagosAuto} + ${totalPagosManual} + (${totalFletes})`);
    console.log(`Saldo = $${saldo.toFixed(2)}`);

    // Verificar transacción por transacción
    console.log('\n=== ÚLTIMAS 10 TRANSACCIONES (orden cronológico) ===');
    let runningBalance = 0;
    const last10 = client.transactions.slice(-10);
    last10.forEach(t => {
        runningBalance += t.amount;
        const sign = t.amount > 0 ? '+' : '';
        console.log(`${t.date.toLocaleDateString().padEnd(12)} | ${t.type.padEnd(5)} | ${sign}$${t.amount.toFixed(2).padStart(12)} | Saldo: $${runningBalance.toFixed(2).padStart(12)} | ${t.description}`);
    });
}

main().finally(() => prisma.$disconnect());
