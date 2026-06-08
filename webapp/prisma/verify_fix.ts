
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log("🔍 Verificando arreglos...");

    const unknown = await prisma.client.findFirst({
        where: { name: "CLIENTE DESCONOCIDO" }
    });
    console.log("Cliente Desconocido:", unknown ? `✅ Encontrado (ID: ${unknown.id})` : "❌ No encontrado");

    const nico = await prisma.client.findFirst({
        where: { name: { contains: "Nicolas - AudioPhones" } }
    });
    console.log("Nicolas Client:", nico ? `✅ Encontrado (ID: ${nico.id}, Name: '${nico.name}')` : "❌ No encontrado");

    // Check Order 2310
    const o2310 = await prisma.order.findUnique({
        where: { order_number: 2310 },
        include: { client: true }
    });
    if (o2310) {
        console.log(`Order 2310 Client: ${o2310.client.name} (ID: ${o2310.clientId})`);
    } else {
        console.log("Order 2310 not found");
    }

    // Check Order 1310
    const o1310 = await prisma.order.findUnique({
        where: { order_number: 1310 },
        include: { client: true }
    });
    if (o1310) {
        console.log(`Order 1310 Client: ${o1310.client.name} (ID: ${o1310.clientId})`);
    } else {
        console.log("Order 1310 not found");
    }
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
