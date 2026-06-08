
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

// Función auxiliar para normalizar fechas (sin hora)
function normalizeDate(d: Date | string): string {
    const dateObj = typeof d === 'string' ? new Date(d) : d;
    return dateObj.toISOString().split('T')[0];
}

async function main() {
    // 1. Cargar datos del sistema
    const dbTxs = await prisma.transaction.findMany({
        where: { clientId: 162 },
        orderBy: { date: 'asc' }
    });

    // 2. Cargar datos manuales (del archivo raw que subiste al principio)
    const rawPath = path.join(process.cwd(), 'prisma/manual_ledgers/162_raw.txt');
    const rawContent = fs.readFileSync(rawPath, 'utf-8');
    const manualEntries = rawContent.split('\n')
        .filter(l => l.trim().length > 0)
        .map(l => {
            const parts = l.split('\t').map(p => p.trim());
            if (parts.length < 4) return null;

            const [dateStr, concepto, , montoStr] = parts;
            // Parse fecha MM/DD/YYYY
            const [mm, dd, yyyy] = dateStr.split('/');
            const date = new Date(parseInt(yyyy), parseInt(mm) - 1, parseInt(dd));

            // Parse monto
            const amount = parseFloat(montoStr.replace('USD', '').replace(',', '').trim());

            // Determinar tipo (simplificado para match)
            const isPayment = ['PAGO', 'COBRO', 'DEVOLUCIÓN', 'CRÉDITO'].some(k => concepto.toUpperCase().includes(k));

            return {
                date,
                dateStr: normalizeDate(date),
                concepto,
                amount,
                type: isPayment ? 'PAGO' : 'CARGO'
            };
        }).filter(x => x !== null);

    console.log(`\n=== AUDITORÍA CRUZADA: MARCOS ROKU (ID 162) ===`);
    console.log(`Registros Manuales: ${manualEntries.length}`);
    console.log(`Registros Sistema: ${dbTxs.length}\n`);

    // 3. Comparar MES a MES para localizar la divergencia
    const months = new Set<string>();
    [...manualEntries, ...dbTxs].forEach((x: any) => {
        const d = x.date;
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        months.add(key);
    });

    const sortedMonths = Array.from(months).sort();

    console.log('--- BALANCE MENSUAL (MANUAL vs SISTEMA) ---');
    console.log('| MES     | MAN_CARGOS | SYS_CARGOS | DIFF_CARGOS | MAN_PAGOS | SYS_PAGOS | DIFF_PAGOS |');
    console.log('|---------|------------|------------|-------------|-----------|-----------|------------|');

    let totalDiffCargos = 0;
    let totalDiffPagos = 0;

    for (const month of sortedMonths) {
        // Filtrar manuales
        const mInMonth = manualEntries.filter(m => {
            const d = m.date;
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` === month;
        });

        // Filtrar sistema (excluyendo "Manual-" para ver lo nativo)
        const sInMonth = dbTxs.filter(t => {
            const d = t.date;
            const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            return k === month && !t.reference?.startsWith('Manual-');
        });

        const mCargos = mInMonth.filter(x => x.type === 'CARGO').reduce((a, b) => a + b.amount, 0);
        const mPagos = mInMonth.filter(x => x.type === 'PAGO').reduce((a, b) => a + b.amount, 0);

        const sCargos = Math.abs(sInMonth.filter(x => x.type === 'CARGO').reduce((a, b) => a + b.amount, 0));
        const sPagos = sInMonth.filter(x => x.type === 'PAGO').reduce((a, b) => a + b.amount, 0);

        const diffCargos = mCargos - sCargos;
        const diffPagos = mPagos - sPagos;

        totalDiffCargos += diffCargos;
        totalDiffPagos += diffPagos;

        if (Math.abs(diffCargos) > 1 || Math.abs(diffPagos) > 1) {
            console.log(`| ${month} | $${mCargos.toFixed(0).padStart(9)} | $${sCargos.toFixed(0).padStart(9)} | $${diffCargos.toFixed(0).padStart(10)} | $${mPagos.toFixed(0).padStart(8)} | $${sPagos.toFixed(0).padStart(8)} | $${diffPagos.toFixed(0).padStart(9)} |`);
        }
    }

    console.log('--------------------------------------------------------------------------------------');
    console.log(`\nTOTAL DIFERENCIA ACUMULADA:`);
    console.log(`Compras/Cargos faltantes en sistema: $${totalDiffCargos.toFixed(2)}`);
    console.log(`Pagos faltantes en sistema: $${totalDiffPagos.toFixed(2)}`);

    // 4. Buscar Pedidos Duplicados en Sistema
    console.log(`\n=== VERIFICACIÓN DE DUPLICADOS EN SISTEMA ===`);
    const orderGroups = new Map();
    dbTxs.filter(t => t.reference?.startsWith('Order #')).forEach(t => {
        if (!orderGroups.has(t.reference)) orderGroups.set(t.reference, []);
        orderGroups.get(t.reference).push(t);
    });

    let dupsFound = false;
    orderGroups.forEach((arr: any[], key: string) => {
        if (arr.length > 1) { // Más de 1 transacción por Order ID? (normalmente hay Cargo, pero si hay 2 cargos?)
            const cargos = arr.filter((t: any) => t.type === 'CARGO');
            if (cargos.length > 1) {
                console.log(`⚠️ DUPLICADO POTENCIAL: ${key} tiene ${cargos.length} cargos asociados.`);
                dupsFound = true;
            }
        }
    });
    if (!dupsFound) console.log("✅ No se encontraron pedidos con doble cargo en DB.");

}

main().finally(() => prisma.$disconnect());
