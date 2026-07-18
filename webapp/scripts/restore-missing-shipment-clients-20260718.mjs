import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const restoration = new Map([
    [541, 162], [512, 256], [511, 149], [510, 87], [493, 173], [487, 208],
    [456, 208], [455, 173], [441, 256], [425, 256], [380, 256],
]);

async function main() {
    const shipments = await prisma.shipment.findMany({
        where: { shipment_number: { in: [...restoration.keys()] } },
        select: { id: true, shipment_number: true, clientId: true },
    });
    if (shipments.length !== restoration.size) {
        throw new Error(`Validación fallida: se esperaban ${restoration.size} envíos y se encontraron ${shipments.length}.`);
    }

    const invalid = shipments.filter((shipment) => shipment.clientId !== null && shipment.clientId !== restoration.get(shipment.shipment_number));
    if (invalid.length > 0) {
        throw new Error(`Validación fallida: hay envíos con cliente distinto y no se modificarán: ${invalid.map((shipment) => `#${shipment.shipment_number}`).join(', ')}.`);
    }

    const pending = shipments.filter((shipment) => shipment.clientId === null);
    console.log(JSON.stringify({ pending: pending.map((shipment) => ({ shipment_number: shipment.shipment_number, restoreClientId: restoration.get(shipment.shipment_number) })) }, null, 2));
    if (process.env.APPLY !== '1') {
        console.log('Modo simulación. Usar APPLY=1 solo después de revisar este resultado.');
        return;
    }

    const backupDir = path.join(process.cwd(), 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const backupPath = path.join(backupDir, `shipment-client-restore-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(backupPath, JSON.stringify(pending, null, 2));
    await prisma.$transaction(pending.map((shipment) => prisma.shipment.update({
        where: { id: shipment.id },
        data: { clientId: restoration.get(shipment.shipment_number) },
    })));
    console.log(`Restaurados ${pending.length} clientes de envío. Respaldo: ${backupPath}`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
}).finally(() => prisma.$disconnect());
