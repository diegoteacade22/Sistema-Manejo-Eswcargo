
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient({ log: ['info', 'warn', 'error'] });

async function main() {
    console.log("🚀 Iniciando Sembrado Rápido (Consolidado)...");
    const startTime = Date.now();

    const prismaDir = path.join(process.cwd(), 'prisma');

    // 1. CARGAR DATOS
    const clientsData = JSON.parse(fs.readFileSync(path.join(prismaDir, 'clients_seed.json'), 'utf-8'));
    const productsData = JSON.parse(fs.readFileSync(path.join(prismaDir, 'products_seed.json'), 'utf-8'));
    const shipmentsData = JSON.parse(fs.readFileSync(path.join(prismaDir, 'shipments_seed.json'), 'utf-8'));
    const ordersData = JSON.parse(fs.readFileSync(path.join(prismaDir, 'orders_seed.json'), 'utf-8'));

    // 2. PRE-CARGAR MAPAS DE MEMORIA (Para evitar miles de SELECT)
    console.log("⏳ Pre-cargando metadatos de la BD...");
    const [dbClients, dbProducts, dbShipments, dbOrders] = await Promise.all([
        prisma.client.findMany({ select: { id: true, old_id: true, name: true, email: true, phone: true } }),
        prisma.product.findMany({ select: { id: true, sku: true, lp1: true, stock: true } }),
        (prisma as any).shipment.findMany({ select: { id: true, shipment_number: true, status: true, notes: true, forwarder: true, weight_fw: true, price_total: true, cost_total: true, date_shipped: true, date_arrived: true, clientId: true } }),
        prisma.order.findMany({
            select: {
                id: true,
                order_number: true,
                status: true,
                total_amount: true,
                clientId: true,
                date: true,
                items: {
                    select: {
                        id: true,
                        productId: true,
                        quantity: true
                    }
                }
            }
        })
    ]);

    const clientOldIdMap = new Map<number, any>(dbClients.filter(c => c.old_id !== null).map(c => [c.old_id as number, c]));
    const clientNameMap = new Map<string, any>(dbClients.map(c => [c.name.trim().toUpperCase(), c]));
    const productSkuMap = new Map<string, any>(dbProducts.map(p => [p.sku, p]));
    const shipmentNumMap = new Map<number, any>(dbShipments.filter((s: any) => s.shipment_number !== null).map((s: any) => [s.shipment_number as number, s]));
    const orderNumMap = new Map<number, any>(dbOrders.filter(o => o.order_number !== null).map(o => [o.order_number as number, o]));

    // 3. PROCESAR CLIENTES (Diferencial)
    console.log(`👥 Sincronizando ${clientsData.length} clientes...`);
    for (const c of clientsData) {
        let existing = clientOldIdMap.get(c.old_id);
        if (!existing) {
            existing = await prisma.client.create({ data: c });
            if (c.old_id) clientOldIdMap.set(c.old_id, existing);
            if (c.name) clientNameMap.set(c.name.trim().toUpperCase(), existing);
        } else {
            // Solo actualizar si hay cambios en campos básicos
            if (existing.name !== c.name) {
                existing = await prisma.client.update({ where: { id: existing.id }, data: { name: c.name, type: c.type } });
                if (c.old_id) clientOldIdMap.set(c.old_id, existing);
                if (c.name) clientNameMap.set(c.name.trim().toUpperCase(), existing);
            }
        }
    }

    // 3.5 Asegurar que existe CLIENTE DESCONOCIDO para fallbacks
    let unknownClient = clientNameMap.get("CLIENTE DESCONOCIDO");
    if (!unknownClient) {
        console.log("⚠️ Creando 'CLIENTE DESCONOCIDO' para asignaciones fallidas...");
        unknownClient = await prisma.client.create({
            data: {
                name: "CLIENTE DESCONOCIDO",
                type: "SYSTEM",
                notes: "Cliente generado automáticamente para pedidos sin cliente identificado"
            }
        });
        clientNameMap.set("CLIENTE DESCONOCIDO", unknownClient);
    }
    const unknownClientId = unknownClient.id;


    // 4. PROCESAR PRODUCTOS
    console.log(`📦 Sincronizando ${productsData.length} productos...`);
    for (const p of productsData) {
        let existing = productSkuMap.get(p.sku);
        if (!existing) {
            existing = await prisma.product.create({ data: p });
            productSkuMap.set(p.sku, existing);
        } else if (existing.lp1 !== p.lp1 || existing.stock !== p.stock) {
            existing = await prisma.product.update({ where: { id: existing.id }, data: p });
            productSkuMap.set(p.sku, existing);
        }
    }

    const parseSafeDate = (d: any) => {
        if (!d) return null;
        const date = new Date(d);
        return isNaN(date.getTime()) ? null : date;
    };

    // 5. PROCESAR ENVIOS
    console.log(`🚛 Sincronizando ${shipmentsData.length} envíos...`);
    for (const s of shipmentsData) {
        const existing = shipmentNumMap.get(s.shipment_number);
        const dbClientId = s.old_client_id
            ? clientOldIdMap.get(s.old_client_id)?.id
            : (s.client_name_match ? clientNameMap.get(s.client_name_match.trim().toUpperCase())?.id : null);

        const data = {
            ...s,
            clientId: dbClientId,
            date_shipped: parseSafeDate(s.date_shipped),
            date_arrived: parseSafeDate(s.date_arrived)
        };
        delete (data as any).old_client_id;
        delete (data as any).client_name_match;

        if (!existing) {
            const created = await (prisma as any).shipment.create({ data });
            shipmentNumMap.set(s.shipment_number, created);
        } else {
            // Check for relevant changes to avoid unnecessary writes, but include ALL visible fields
            const shippedTime = data.date_shipped?.getTime() || 0;
            const arrivedTime = data.date_arrived?.getTime() || 0;
            const existingShipped = existing.date_shipped?.getTime() || 0;
            const existingArrived = existing.date_arrived?.getTime() || 0;

            const hasChanges =
                existing.status !== s.status ||
                existing.notes !== s.notes ||
                existing.forwarder !== s.forwarder ||
                existing.weight_fw !== s.weight_fw ||
                existing.price_total !== s.price_total ||
                existing.cost_total !== s.cost_total ||
                shippedTime !== existingShipped ||
                arrivedTime !== existingArrived ||
                existing.clientId !== dbClientId; // Also update if client changed

            if (hasChanges) {
                await (prisma as any).shipment.update({ where: { id: existing.id }, data });
            }
        }
    }

    // 6. PROCESAR PEDIDOS (EL MÁS PESADO)
    console.log(`📑 Sincronizando ${ordersData.length} pedidos...`);
    let orderCounter = 0;
    for (const o of ordersData) {
        const existing = orderNumMap.get(o.order_number);
        const dbClientId = o.client_old_id ? clientOldIdMap.get(o.client_old_id)?.id : (o.client_name_match ? clientNameMap.get(o.client_name_match.trim().toUpperCase())?.id : null);

        const orderDate = parseSafeDate(o.date) || new Date();
        const items = o.items || [];
        let totalAmount = o.total_amount || 0;

        // Doble verificación: si el total es 0 pero hay items, recalculamos
        if (totalAmount === 0 && items.length > 0) {
            totalAmount = items.reduce((sum: number, i: any) => sum + (i.unit_price * i.quantity), 0);
        }

        const orderData = {
            order_number: o.order_number,
            clientId: dbClientId || unknownClientId, // Fallback to 'Unknown Client' instead of ID 1
            date: orderDate,
            status: o.status,
            total_amount: totalAmount,
            paymentMethod: o.payment_method
        };

        let dbOrder: any;
        if (!existing) {
            dbOrder = await prisma.order.create({
                data: orderData as any
            });
        } else {
            // Comparación simple de cabecera
            if (existing.status !== o.status || existing.total_amount !== o.total_amount || existing.clientId !== (dbClientId || unknownClientId)) {
                dbOrder = await prisma.order.update({
                    where: { id: existing.id },
                    data: orderData as any
                });
            } else {
                dbOrder = existing;
            }
        }

        // ITEMS: Solo si el pedido es nuevo o hubo cambios (simplificado: siempre sync items si queremos ser precisos, pero vamos a optimizar)
        // Para ir "enorme", solo borramos si cambió el total o si es nuevo
        // Always sync items for processed orders to ensure linkage/updates
        // (Removing the existing.total_amount check because we need to fix relations even if total is same)
        if (true) {
            await prisma.orderItem.deleteMany({ where: { orderId: dbOrder.id } });
            for (const item of o.items) {
                const prod = productSkuMap.get(item.sku);
                const shipId = item.shipment_number ? shipmentNumMap.get(item.shipment_number)?.id : null;

                await prisma.orderItem.create({
                    data: {
                        order: { connect: { id: dbOrder.id } },
                        product: (item.sku && productSkuMap.has(item.sku)) ? { connect: { sku: item.sku } } : undefined,
                        productName: item.product_name || item.sku || "Producto sin Nombre",
                        quantity: item.quantity,
                        unit_price: item.unit_price,
                        unit_cost: item.unit_cost,
                        subtotal: item.unit_price * item.quantity,
                        profit: item.profit,
                        shipment: shipId ? { connect: { id: shipId } } : undefined,
                        status: item.status
                    } as any
                });
            }

            // Actualizar Transacciones solo si cambió el pedido
            await prisma.transaction.deleteMany({ where: { reference: { contains: `Order #${o.order_number}` } } });
            if (o.total_amount > 0) {
                await prisma.transaction.create({
                    data: {
                        clientId: dbOrder.clientId,
                        date: dbOrder.date,
                        type: 'CARGO',
                        amount: o.total_amount,
                        description: `Compra - Pedido #${o.order_number}`,
                        reference: `Order #${o.order_number}`
                    }
                });
            }
            if (o.payment_amount > 0) {
                await prisma.transaction.create({
                    data: {
                        clientId: dbOrder.clientId,
                        date: dbOrder.date,
                        type: 'PAGO',
                        amount: -o.payment_amount,
                        description: `Pago ${o.payment_method || ''}`.trim(),
                        reference: `Order #${o.order_number} - Pago`
                    }
                });
            }
        }

        orderCounter++;
        console.log(`   ...procesados ${orderCounter} pedidos (Order ${o.order_number})`);
    }

    const endTime = Date.now();
    console.log(`\n✅ Sincronización finalizada en ${(endTime - startTime) / 1000}s.`);
}

main()
    .catch(e => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
