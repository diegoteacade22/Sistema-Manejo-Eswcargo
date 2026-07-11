
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient({ log: ['info', 'warn', 'error'] });

function resolveImportedTxOldClientId(tx: any): number | null {
    const reference = String(tx?.reference || '').toUpperCase();

    if (reference.startsWith('CC-IMPORT-MARCOS_CC-')) {
        return 162;
    }

    const parsedClientId = Number(tx?.clientId);
    return Number.isFinite(parsedClientId) ? parsedClientId : null;
}

async function main() {
    const isFullSync = process.env.SYNC_MODE === 'FULL';
    console.log(`🚀 Iniciando Sembrado Rápido (Consolidado) - Modo: ${isFullSync ? 'COMPLETO' : 'DIFERENCIAL'}...`);
    const startTime = Date.now();

    const prismaDir = path.join(process.cwd(), 'prisma');

    // 1. CARGAR DATOS
    const clientsData = JSON.parse(fs.readFileSync(path.join(prismaDir, 'clients_seed.json'), 'utf-8'));
    const productsData = JSON.parse(fs.readFileSync(path.join(prismaDir, 'products_seed.json'), 'utf-8'));
    const shipmentsData = JSON.parse(fs.readFileSync(path.join(prismaDir, 'shipments_seed.json'), 'utf-8'));
    const ordersData = JSON.parse(fs.readFileSync(path.join(prismaDir, 'orders_seed.json'), 'utf-8'));
    const shipmentReconciliationPath = path.join(prismaDir, 'shipment_reconciliation_seed.json');
    const shipmentReconciliationData = fs.existsSync(shipmentReconciliationPath)
        ? JSON.parse(fs.readFileSync(shipmentReconciliationPath, 'utf-8'))
        : [];
    const orderDuplicateCounts = new Map<number, number>();
    const uniqueOrdersByNumber = new Map<number, any>();
    for (const order of ordersData as any[]) {
        if (!order?.order_number) continue;
        const orderNumber = Number(order.order_number);
        orderDuplicateCounts.set(orderNumber, (orderDuplicateCounts.get(orderNumber) || 0) + 1);
        uniqueOrdersByNumber.set(orderNumber, order);
    }
    const duplicateOrderNumbers = Array.from(orderDuplicateCounts.entries())
        .filter(([, count]) => count > 1)
        .map(([orderNumber, count]) => `#${orderNumber} x${count}`);
    if (duplicateOrderNumbers.length > 0) {
        console.warn(`⚠️ Pedidos duplicados en Excel normalizados antes de importar: ${duplicateOrderNumbers.join(', ')}`);
    }
    const normalizedOrdersData = Array.from(uniqueOrdersByNumber.values());

    // ID tracking for cleanup
    const processedShipmentIds = new Set<number>();
    const processedOrderIds = new Set<number>();
    const processedProductIds = new Set<number>();
    const processedClientIds = new Set<number>();
    const processedSupplierIds = new Set<number>();
    const processedPurchaseIds = new Set<number>();

    // 2. PRE-CARGAR MAPAS DE MEMORIA (Para evitar miles de SELECT)
    console.log("⏳ Pre-cargando metadatos de la BD...");
    const [dbClients, dbProducts, dbShipments, dbOrders, dbSuppliers] = await Promise.all([
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
                shipmentId: true,
            }
        }),
        prisma.supplier.findMany({ select: { id: true, old_id: true, name: true } })
    ]);

    const clientOldIdMap = new Map<number, any>(dbClients.filter(c => c.old_id !== null).map(c => [c.old_id as number, c]));
    const clientNameMap = new Map<string, any>(dbClients.map(c => [c.name.trim().toUpperCase(), c]));
    const productSkuMap = new Map<string, any>(dbProducts.map(p => [p.sku, p]));
    const shipmentNumMap = new Map<number, any>(dbShipments.filter((s: any) => s.shipment_number !== null).map((s: any) => [s.shipment_number as number, s]));
    const orderNumMap = new Map<number, any>(dbOrders.filter(o => o.order_number !== null).map(o => [o.order_number as number, o]));
    const supplierOldIdMap = new Map<number, any>(dbSuppliers.filter(s => s.old_id !== null).map(s => [s.old_id as number, s]));
    const supplierNameMap = new Map<string, any>(dbSuppliers.map(s => [s.name.trim().toUpperCase(), s]));

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
        processedClientIds.add(existing.id);
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
    processedClientIds.add(unknownClientId);

    // 3.7 PROCESAR PROVEEDORES
    console.log("🏢 Sincronizando Proveedores...");
    const suppliersData = JSON.parse(fs.readFileSync(path.join(prismaDir, 'suppliers_seed.json'), 'utf-8'));
    for (const s of suppliersData) {
        let existing = supplierOldIdMap.get(s.old_id);
        if (!existing && s.name) existing = supplierNameMap.get(s.name.trim().toUpperCase());

        if (!existing) {
            existing = await prisma.supplier.create({ data: s });
            if (s.old_id) supplierOldIdMap.set(s.old_id, existing);
            if (s.name) supplierNameMap.set(s.name.trim().toUpperCase(), existing);
        } else {
            existing = await prisma.supplier.update({ where: { id: existing.id }, data: s });
        }
        processedSupplierIds.add(existing.id);
    }


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
        processedProductIds.add(existing.id);
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

        let dbShipment: any;
        if (!existing) {
            dbShipment = await (prisma as any).shipment.create({ data });
            shipmentNumMap.set(s.shipment_number, dbShipment);
        } else {
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
                existing.clientId !== dbClientId;

            if (hasChanges) {
                dbShipment = await (prisma as any).shipment.update({ where: { id: existing.id }, data });
            } else {
                dbShipment = existing;
            }
        }
        processedShipmentIds.add(dbShipment.id);
    }

    // 6. PROCESAR PEDIDOS
    console.log(`📑 Sincronizando ${normalizedOrdersData.length} pedidos...`);
    let orderCounter = 0;
    const syncedOrderNumbers = new Set(normalizedOrdersData.map((o: any) => o.order_number));

    for (const o of (normalizedOrdersData as any[])) {
        const existing = orderNumMap.get(o.order_number);
        const dbClientId = o.client_old_id ? clientOldIdMap.get(o.client_old_id)?.id : (o.client_name_match ? clientNameMap.get(o.client_name_match.trim().toUpperCase())?.id : null);

        const orderDate = parseSafeDate(o.date) || new Date();
        const items = o.items || [];
        let totalAmount = o.total_amount || 0;

        if (totalAmount === 0 && items.length > 0) {
            totalAmount = items.reduce((sum: number, i: any) => sum + (i.unit_price * i.quantity), 0);
        }

        const itemStatuses = [...new Set(
            items
                .map((i: any) => (i.status || '').toString().trim())
                .filter((value: string) => value.length > 0)
        )];

        const itemShipmentIds = [...new Set(
            items
                .map((item: any) => item.shipment_number ? shipmentNumMap.get(item.shipment_number)?.id : null)
                .filter((value: number | null | undefined): value is number => typeof value === 'number')
        )];

        const resolvedStatus = itemStatuses.length === 1 ? itemStatuses[0] : o.status;
        const resolvedShipmentId = itemShipmentIds.length === 1 ? itemShipmentIds[0] : null;

        const orderData = {
            order_number: o.order_number,
            clientId: dbClientId || unknownClientId,
            date: orderDate,
            status: resolvedStatus,
            shipmentId: resolvedShipmentId,
            total_amount: totalAmount,
            paymentMethod: o.payment_method
        };

        let dbOrder: any;
        if (!existing) {
            dbOrder = await prisma.order.create({
                data: orderData as any
            });
            orderNumMap.set(o.order_number, dbOrder);
        } else {
            if (
                existing.status !== resolvedStatus ||
                existing.total_amount !== totalAmount ||
                existing.clientId !== (dbClientId || unknownClientId) ||
                existing.shipmentId !== resolvedShipmentId
            ) {
                dbOrder = await prisma.order.update({
                    where: { id: existing.id },
                    data: orderData as any
                });
                orderNumMap.set(o.order_number, dbOrder);
            } else {
                dbOrder = existing;
            }
        }
        processedOrderIds.add(dbOrder.id);

        // Actualizar Items
        // Actualizar Items (USANDO createMany PARA VELOCIDAD)
        await prisma.orderItem.deleteMany({ where: { orderId: dbOrder.id } });
        const orderItemsToCreate = o.items.map((item: any) => {
            const shipId = item.shipment_number ? shipmentNumMap.get(item.shipment_number)?.id : null;
            const dbProd = (item.sku && productSkuMap.has(item.sku)) ? productSkuMap.get(item.sku) : null;
            return {
                orderId: dbOrder.id,
                productId: dbProd?.id || null,
                productName: item.product_name || item.sku || "Producto sin Nombre",
                quantity: item.quantity,
                unit_price: item.unit_price,
                unit_cost: item.unit_cost,
                subtotal: item.unit_price * item.quantity,
                profit: item.profit,
                shipmentId: shipId,
                status: item.status
            };
        });

        if (orderItemsToCreate.length > 0) {
            await prisma.orderItem.createMany({ data: orderItemsToCreate });
        }

        // Actualizar Transacciones (ELIMINACIÓN PRECISA para evitar borrar otros pedidos que contengan el mismo número)
        // No creamos aquí, colectamos para batch final

        // Transaction collection moved to batch logic below

        orderCounter++;
        if (orderCounter % 50 === 0) console.log(`   ...procesados ${orderCounter} pedidos`);
    }

    // 6.1 RECONCILIAR ASIGNACIONES DE ENVIO HISTORICAS
    // Los cambios de ENVIO NRO no modifican la fecha de venta, por lo que no
    // aparecen en un lote de 7/30 dias. Se reconstruyen solo los pedidos que
    // tienen una asignacion actual en la planilla o una asignacion previa en BD.
    const reconciliationByOrderNumber = new Map<number, any>(
        (shipmentReconciliationData as any[])
            .filter(order => Number.isInteger(order?.order_number))
            .map(order => [order.order_number, order])
    );
    const sheetAssignedOrderNumbers = new Set<number>(
        (shipmentReconciliationData as any[])
            .filter(order => (order.items || []).some((item: any) => item.shipment_number))
            .map(order => order.order_number)
    );
    const dbAssignedOrders = await prisma.order.findMany({
        where: {
            OR: [
                { shipmentId: { not: null } },
                { items: { some: { shipmentId: { not: null } } } }
            ]
        },
        select: { id: true, order_number: true, shipmentId: true }
    });
    const dbAssignedByOrderNumber = new Map<number, any>(
        dbAssignedOrders
            .filter(order => typeof order.order_number === 'number')
            .map(order => [order.order_number as number, order])
    );
    const reconciliationOrderNumbers = new Set<number>([
        ...sheetAssignedOrderNumbers,
        ...dbAssignedByOrderNumber.keys()
    ]);
    const reconciliationOrderIds: number[] = [];
    const reconciliationItemsToCreate: any[] = [];
    const affectedShipmentIds = new Set<number>();
    const reconciliationDbOrderIds = Array.from(reconciliationOrderNumbers)
        .filter(orderNumber => !syncedOrderNumbers.has(orderNumber))
        .map(orderNumber => orderNumMap.get(orderNumber)?.id)
        .filter((orderId): orderId is number => typeof orderId === 'number');
    const currentReconciliationItems = reconciliationDbOrderIds.length > 0
        ? await prisma.orderItem.findMany({
            where: { orderId: { in: reconciliationDbOrderIds } },
            select: {
                orderId: true,
                productName: true,
                quantity: true,
                unit_price: true,
                unit_cost: true,
                profit: true,
                shipmentId: true,
                status: true
            }
        })
        : [];
    const currentItemsByOrderId = new Map<number, any[]>();
    for (const item of currentReconciliationItems) {
        const items = currentItemsByOrderId.get(item.orderId) || [];
        items.push(item);
        currentItemsByOrderId.set(item.orderId, items);
    }
    const itemSignature = (item: any, shipmentId: number | null) => [
        item.product_name || item.productName || item.sku || '',
        item.quantity || 0,
        item.unit_price || 0,
        item.unit_cost || 0,
        item.profit || 0,
        shipmentId || '',
        item.status || ''
    ].join('|');

    for (const orderNumber of reconciliationOrderNumbers) {
        if (syncedOrderNumbers.has(orderNumber)) continue;

        const sourceOrder = reconciliationByOrderNumber.get(orderNumber);
        const dbOrder = orderNumMap.get(orderNumber);
        if (!sourceOrder || !dbOrder) {
            console.warn(`   ⚠️ No se pudo reconciliar pedido #${orderNumber}: falta ${!sourceOrder ? 'detalle en planilla' : 'pedido en base'}.`);
            continue;
        }

        const sourceItems = sourceOrder.items || [];
        const sourceShipmentIds = Array.from(new Set<number>(
            sourceItems
                .map((item: any): number | null => item.shipment_number ? shipmentNumMap.get(item.shipment_number)?.id || null : null)
                .filter((shipmentId: number | null | undefined): shipmentId is number => typeof shipmentId === 'number')
        ));
        const resolvedShipmentId = sourceShipmentIds.length === 1 ? sourceShipmentIds[0] : null;
        const expectedItemSignatures: string[] = sourceItems
            .map((item: any) => itemSignature(item, item.shipment_number ? shipmentNumMap.get(item.shipment_number)?.id || null : null))
            .sort();
        const currentItemSignatures: string[] = (currentItemsByOrderId.get(dbOrder.id) || [])
            .map((item: any) => itemSignature(item, item.shipmentId))
            .sort();
        const itemsMatch = expectedItemSignatures.length === currentItemSignatures.length &&
            expectedItemSignatures.every((signature, index) => signature === currentItemSignatures[index]);

        if (itemsMatch && dbOrder.shipmentId === resolvedShipmentId) {
            continue;
        }

        if (dbOrder.shipmentId !== resolvedShipmentId) {
            await prisma.order.update({
                where: { id: dbOrder.id },
                data: { shipmentId: resolvedShipmentId }
            });
        }

        reconciliationOrderIds.push(dbOrder.id);
        if (dbOrder.shipmentId) affectedShipmentIds.add(dbOrder.shipmentId);
        sourceShipmentIds.forEach((shipmentId: number) => affectedShipmentIds.add(shipmentId));

        for (const item of sourceItems) {
            const shipmentId = item.shipment_number ? shipmentNumMap.get(item.shipment_number)?.id : null;
            const product = item.sku ? productSkuMap.get(item.sku) : null;
            reconciliationItemsToCreate.push({
                orderId: dbOrder.id,
                productId: product?.id || null,
                productName: item.product_name || item.sku || 'Producto sin Nombre',
                quantity: item.quantity,
                unit_price: item.unit_price,
                unit_cost: item.unit_cost,
                subtotal: item.unit_price * item.quantity,
                profit: item.profit,
                shipmentId,
                status: item.status
            });
        }
    }

    if (reconciliationOrderIds.length > 0) {
        console.log(`   ↻ Reconciliando ${reconciliationOrderIds.length} pedidos con asignaciones historicas...`);
        await prisma.orderItem.deleteMany({ where: { orderId: { in: reconciliationOrderIds } } });
        if (reconciliationItemsToCreate.length > 0) {
            await prisma.orderItem.createMany({ data: reconciliationItemsToCreate });
        }
    }

    const shipmentIdsToRefresh = new Set<number>(affectedShipmentIds);
    for (const order of normalizedOrdersData as any[]) {
        for (const item of order.items || []) {
            const shipmentId = item.shipment_number ? shipmentNumMap.get(item.shipment_number)?.id : null;
            if (shipmentId) shipmentIdsToRefresh.add(shipmentId);
        }
    }

    if (shipmentIdsToRefresh.size > 0) {
        const assignedItems = await prisma.orderItem.groupBy({
            by: ['shipmentId'],
            where: { shipmentId: { in: Array.from(shipmentIdsToRefresh) } },
            _sum: { quantity: true }
        });
        const itemCountByShipmentId = new Map(
            assignedItems
                .filter(group => typeof group.shipmentId === 'number')
                .map(group => [group.shipmentId as number, group._sum.quantity || 0])
        );

        for (const shipmentId of shipmentIdsToRefresh) {
            await (prisma as any).shipment.update({
                where: { id: shipmentId },
                data: { item_count: itemCountByShipmentId.get(shipmentId) || 0 }
            });
        }
    }

    // 6.7 SINCRONIZACIÓN MAESTRA DE TRANSACCIONES (CLIENTES Y PROVEEDORES)
    console.log("💰 Sincronizando todas las transacciones financieras...");
    const allTxs: any[] = [];

    // A. Transacciones de Pedidos
    for (const o of normalizedOrdersData) {
        const dbClientId = o.client_old_id ? clientOldIdMap.get(o.client_old_id)?.id : (o.client_name_match ? clientNameMap.get(o.client_name_match.trim().toUpperCase())?.id : null);
        if (!dbClientId) continue;
        const oDate = parseSafeDate(o.date) || new Date();

        if (o.total_amount > 0) {
            allTxs.push({
                clientId: dbClientId,
                date: oDate,
                type: 'CARGO',
                amount: -o.total_amount,
                description: `Compra - Pedido #${o.order_number}`,
                reference: `Order #${o.order_number}`
            });
        }
        if (o.payment_amount > 0) {
            allTxs.push({
                clientId: dbClientId,
                date: oDate,
                type: 'PAGO',
                amount: o.payment_amount,
                description: `Pago ${o.payment_method || ''}`.trim(),
                reference: `Order #${o.order_number} - Pago`
            });
        }
    }

    // B. Transacciones de Envíos (Fletes)
    for (const s of (shipmentsData as any[])) {
        const dbClientId = s.old_client_id
            ? clientOldIdMap.get(s.old_client_id)?.id
            : (s.client_name_match ? clientNameMap.get(s.client_name_match.trim().toUpperCase())?.id : null);

        if (dbClientId && s.price_total > 0) {
            allTxs.push({
                clientId: dbClientId,
                date: parseSafeDate(s.date_shipped) || new Date(),
                type: 'CARGO',
                amount: -s.price_total,
                description: `Flete - Envío #${s.shipment_number}`,
                reference: `Envío #${s.shipment_number}-${s.price_total}-${s.date_shipped || 'N/A'}`
            });
        }
    }

    // C. Pagos Extras
    const paymentsData = JSON.parse(fs.readFileSync(path.join(prismaDir, 'payments_extra_seed.json'), 'utf8'));
    for (const p of paymentsData) {
        const dbClientId = p.client_old_id ? clientOldIdMap.get(p.client_old_id)?.id : (p.client_name_match ? clientNameMap.get(p.client_name_match.trim().toUpperCase())?.id : null);
        if (dbClientId && p.amount !== 0) {
            const date = p.date ? new Date(p.date) : new Date();
            allTxs.push({
                clientId: dbClientId,
                date: date,
                type: 'PAGO',
                amount: Math.abs(p.amount),
                description: p.description || 'Cobro / Pago',
                reference: `PagoExtra-${date.getTime()}-${p.amount}`
            });
        }
    }

    // D. Transacciones Manuales (Ledgers históricos por cliente)
    const manualLedgersDir = path.join(prismaDir, 'manual_ledgers');
    if (fs.existsSync(manualLedgersDir)) {
        const ledgerFiles = fs.readdirSync(manualLedgersDir).filter(f => f.endsWith('.json') && !f.includes('raw'));
        for (const ledgerFile of ledgerFiles) {
            const clientIdFromFile = parseInt(ledgerFile.replace('.json', ''));
            if (isNaN(clientIdFromFile)) continue;

            const manualTxs = JSON.parse(fs.readFileSync(path.join(manualLedgersDir, ledgerFile), 'utf-8'));
            for (const tx of manualTxs) {
                // Parse date from MM/DD/YYYY format
                const dateParts = tx.date.split('/');
                let txDate = new Date();
                if (dateParts.length === 3) {
                    const month = parseInt(dateParts[0]) - 1;
                    const day = parseInt(dateParts[1]);
                    const year = parseInt(dateParts[2]);
                    txDate = new Date(year, month, day);
                }

                allTxs.push({
                    clientId: clientIdFromFile,
                    date: txDate,
                    type: tx.type,
                    amount: tx.amount,
                    description: tx.description || 'Movimiento Manual',
                    reference: `Manual-${clientIdFromFile}-${tx.date}-${Math.abs(tx.amount)}`
                });
            }
            console.log(`   ✅ Cargadas ${manualTxs.length} transacciones manuales para cliente ${clientIdFromFile}`);
        }
    }

    // D2. Transacciones importadas desde Google Sheets (CC)
    const transactionsFile = path.join(prismaDir, 'transactions.json');
    if (fs.existsSync(transactionsFile)) {
        console.log("📥 Importando transacciones desde CC sheets...");
        const importedTxs = JSON.parse(fs.readFileSync(transactionsFile, 'utf-8'));
        const quarantinedTxs = importedTxs.filter((tx: any) => String(tx?.reference || '').startsWith('CC-Import-'));
        if (quarantinedTxs.length > 0 && process.env.ALLOW_CC_IMPORT !== '1') {
            console.warn(`   ⚠️ ${quarantinedTxs.length} transacciones CC-Import-* ignoradas para evitar duplicar cuentas corrientes legacy.`);
        }
        let importCount = 0;

        for (const tx of importedTxs) {
            if (String(tx?.reference || '').startsWith('CC-Import-') && process.env.ALLOW_CC_IMPORT !== '1') {
                continue;
            }

            const txOldClientId = resolveImportedTxOldClientId(tx);
            if (!txOldClientId) {
                console.log(`   ⚠️ Transacción sin clientId válido (${tx?.reference || 'sin referencia'}), saltando`);
                continue;
            }

            // Map clientId from old_id to actual database ID
            const dbClientId = clientOldIdMap.get(txOldClientId)?.id;
            if (!dbClientId) {
                console.log(`   ⚠️ Cliente ${txOldClientId} no encontrado, saltando transacción`);
                continue;
            }

            allTxs.push({
                clientId: dbClientId,
                date: new Date(tx.date),
                type: tx.type,
                amount: tx.amount,
                description: tx.description || 'Transacción CC importada',
                reference: tx.reference || `CC-Import-${Date.now()}-${importCount}`
            });
            importCount++;
        }

        console.log(`   ✅ ${importCount} transacciones CC importadas`);
    }

    // E. Transacciones de Proveedores (Compras y Pagos Automáticos)
    console.log("� Procesando transacciones de proveedores...");
    const purchasesData = JSON.parse(fs.readFileSync(path.join(prismaDir, 'purchases_seed.json'), 'utf-8'));
    for (const p of purchasesData) {
        const dbSupplierId = p.supplier_old_id
            ? supplierOldIdMap.get(p.supplier_old_id)?.id
            : (p.supplier_name ? supplierNameMap.get(p.supplier_name.trim().toUpperCase())?.id : null);

        if (!dbSupplierId) continue;
        const pDate = p.date ? new Date(p.date) : new Date();

        // Cargo por la compra
        allTxs.push({
            supplierId: dbSupplierId,
            date: pDate,
            type: 'CARGO',
            amount: -p.total_amount,
            description: `Compra Invoice #${p.invoice_number}`,
            reference: `Purchase #${p.invoice_number}`
        });

        // Pago automático (balance 0)
        allTxs.push({
            supplierId: dbSupplierId,
            date: pDate,
            type: 'PAGO',
            amount: p.total_amount,
            description: `Pago Automático Invoice #${p.invoice_number} (${p.payment_method || 'N/A'})`,
            reference: `Purchase #${p.invoice_number} - Pago`
        });
    }

    // EJECUCIÓN BATCH DE TRANSACCIONES
    console.log(`🚀 Ejecutando batch de ${allTxs.length} transacciones...`);
    const txReferences = Array.from(
        new Set(
            allTxs
                .map(tx => tx.reference)
                .filter((ref): ref is string => typeof ref === 'string' && ref.trim().length > 0)
        )
    );

    if (isFullSync) {
        // En FULL reconstruimos universo completo de referencias gestionadas por sync.
        await prisma.transaction.deleteMany({
            where: {
                OR: [
                    { reference: { startsWith: 'Order #' } },
                    { reference: { startsWith: 'Envío #' } },
                    { reference: { startsWith: 'PagoExtra-' } },
                    { reference: { startsWith: 'Purchase #' } },
                    { reference: { startsWith: 'Manual-' } },
                    { reference: { startsWith: 'CC-Import-' } }
                ]
            }
        });
    } else if (txReferences.length > 0) {
        // En DIFF solo tocamos las referencias presentes en este lote para no perder histórico.
        const REF_CHUNK_SIZE = 500;
        for (let i = 0; i < txReferences.length; i += REF_CHUNK_SIZE) {
            const refsChunk = txReferences.slice(i, i + REF_CHUNK_SIZE);
            await prisma.transaction.deleteMany({
                where: { reference: { in: refsChunk } }
            });
        }
    }

    // Insertar en bloques para evitar límites de la base de datos
    const CHUNK_SIZE = 100;
    for (let i = 0; i < allTxs.length; i += CHUNK_SIZE) {
        const chunk = allTxs.slice(i, i + CHUNK_SIZE);
        await prisma.transaction.createMany({ data: chunk });
    }
    console.log("   ✅ Transacciones sincronizadas.");

    // 6.8 ACTUALIZAR TABLAS DE COMPRA (ENCABEZADOS Y DETALLES)
    for (const p of purchasesData) {
        const dbSupplierId = p.supplier_old_id
            ? supplierOldIdMap.get(p.supplier_old_id)?.id
            : (p.supplier_name ? supplierNameMap.get(p.supplier_name.trim().toUpperCase())?.id : null);

        if (!dbSupplierId) continue;

        const purchaseData = {
            invoice_number: p.invoice_number,
            date: p.date ? new Date(p.date) : new Date(),
            supplierId: dbSupplierId,
            total_amount: p.total_amount,
            payment_method: p.payment_method
        };

        let dbPurchase = await (prisma as any).purchase.findUnique({ where: { invoice_number: p.invoice_number } });
        if (!dbPurchase) {
            dbPurchase = await (prisma as any).purchase.create({ data: purchaseData });
        } else {
            dbPurchase = await (prisma as any).purchase.update({ where: { id: dbPurchase.id }, data: purchaseData });
        }
        processedPurchaseIds.add(dbPurchase.id);

        // Actualizar Items de Compra (createMany para velocidad)
        await (prisma as any).purchaseItem.deleteMany({ where: { purchaseId: dbPurchase.id } });
        const purchaseItemsToCreate = p.items.map((item: any) => ({
            purchaseId: dbPurchase.id,
            sku: (item.sku && productSkuMap.has(item.sku)) ? item.sku : null,
            productName: item.product_name || item.sku || "Producto Compra",
            quantity: item.quantity,
            unit_cost: item.unit_cost,
            subtotal: item.subtotal
        }));

        if (purchaseItemsToCreate.length > 0) {
            await (prisma as any).purchaseItem.createMany({ data: purchaseItemsToCreate });
        }
    }

    // 7. LIMPIEZA DE HUERFANOS (Solo en Sincronización Completa)
    if (isFullSync) {
        console.log("🧹 Iniciando limpieza de registros huérfanos...");

        // Limpiar Pedidos que ya no están en Excel
        const orphanedOrders = await prisma.order.deleteMany({
            where: { id: { notIn: Array.from(processedOrderIds) } }
        });
        console.log(`   ✅ Pedidos huérfanos eliminados: ${orphanedOrders.count}`);

        // Limpiar Envíos que ya no están en Excel
        const orphanedShipments = await (prisma as any).shipment.deleteMany({
            where: { id: { notIn: Array.from(processedShipmentIds) } }
        });
        console.log(`   ✅ Envíos huérfanos eliminados: ${orphanedShipments.count}`);

        // Limpiar Transacciones asociadas a registros que ya no existen
        const currentRefPrefixesOrder = normalizedOrdersData.flatMap((o: any) => {
            const refs = [`Order #${o.order_number}`];
            if (o.payment_amount > 0) refs.push(`Order #${o.order_number} - Pago`);
            return refs;
        });
        const currentRefPrefixesShip = shipmentsData.map((s: any) => `Envío #${s.shipment_number}-${s.price_total}-${s.date_shipped || 'N/A'}`);
        const currentRefPrefixesPay = paymentsData.map((p: any) => `PagoExtra-${p.date ? new Date(p.date).getTime() : ''}-${p.amount}`);

        const orphanedTransactions = await prisma.transaction.deleteMany({
            where: {
                OR: [
                    { reference: { startsWith: 'Order #' } },
                    { reference: { startsWith: 'Envío #' } },
                    { reference: { startsWith: 'PagoExtra-' } }
                ],
                NOT: {
                    OR: [
                        ...currentRefPrefixesOrder.map((ref: string) => ({ reference: { equals: ref } })),
                        ...currentRefPrefixesShip.map((ref: string) => ({ reference: { equals: ref } })),
                        ...currentRefPrefixesPay.map((ref: string) => ({ reference: { equals: ref } }))
                    ]
                }
            }
        });
        console.log(`   ✅ Transacciones huérfanas eliminadas: ${orphanedTransactions.count}`);

        // Limpiar Compras huérfanas
        const orphanedPurchases = await (prisma as any).purchase.deleteMany({
            where: { id: { notIn: Array.from(processedPurchaseIds) } }
        });
        console.log(`   ✅ Compras huérfanas eliminadas: ${orphanedPurchases.count}`);
    }

    const endTime = Date.now();
    console.log(`\n✅ Sincronización finalizada en ${(endTime - startTime) / 1000}s.`);
}

main()
    .catch(e => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
