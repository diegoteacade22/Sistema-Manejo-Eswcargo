import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertAgentProvidedTotal, canonicalizeAgentOrderItems } from "@/lib/agent-order";

function getExpectedApiKey() {
    return (process.env.AGENT_API_KEY || process.env.AUTH_SECRET || "").trim();
}

function getProvidedApiKey(req: Request) {
    const direct = req.headers.get("x-agent-key")?.trim();
    if (direct) return direct;

    const auth = req.headers.get("authorization")?.trim();
    if (auth?.toLowerCase().startsWith("bearer ")) {
        return auth.slice(7).trim();
    }

    return "";
}

function parseNumber(value: unknown, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function toDateOrNow(value: unknown) {
    if (!value) return new Date();
    const d = new Date(String(value));
    return Number.isNaN(d.getTime()) ? new Date() : d;
}

type AgentAction =
    | "createClient"
    | "createProduct"
    | "createSupplier"
    | "createOrder";

export async function POST(req: Request) {
    const expectedApiKey = getExpectedApiKey();
    const providedApiKey = getProvidedApiKey(req);

    if (!expectedApiKey) {
        return NextResponse.json({ error: "AGENT_API_KEY no configurada" }, { status: 500 });
    }

    if (!providedApiKey || providedApiKey !== expectedApiKey) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const body = await req.json();
        const action = String(body?.action || "") as AgentAction;
        const data = body?.data || {};
        const dryRun = Boolean(body?.dryRun);

        if (!action) {
            return NextResponse.json({ error: "action requerida" }, { status: 400 });
        }

        if (![
            "createClient",
            "createProduct",
            "createSupplier",
            "createOrder",
        ].includes(action)) {
            return NextResponse.json({ error: `Acción no soportada: ${action}` }, { status: 400 });
        }

        if (action === "createClient") {
            const payload = {
                name: String(data?.name || "").trim(),
                email: data?.email ? String(data.email).trim() : null,
                phone: data?.phone ? String(data.phone).trim() : null,
                address: data?.address ? String(data.address).trim() : null,
                city: data?.city ? String(data.city).trim() : null,
                country: data?.country ? String(data.country).trim() : null,
                notes: data?.notes ? String(data.notes).trim() : null,
                canAccess: data?.canAccess !== undefined ? Boolean(data.canAccess) : true,
            };

            if (!payload.name) {
                return NextResponse.json({ error: "name es obligatorio" }, { status: 400 });
            }

            if (dryRun) {
                return NextResponse.json({ ok: true, action, dryRun: true, payload });
            }

            const created = await prisma.client.create({ data: payload });
            return NextResponse.json({ ok: true, action, created });
        }

        if (action === "createProduct") {
            const payload = {
                sku: String(data?.sku || "").trim(),
                name: String(data?.name || "").trim(),
                model: data?.model ? String(data.model).trim() : null,
                brand: data?.brand ? String(data.brand).trim() : null,
                color_grade: data?.color_grade ? String(data.color_grade).trim() : null,
                weight: data?.weight !== undefined ? parseNumber(data.weight, 0) : null,
                lp1: data?.lp1 !== undefined ? parseNumber(data.lp1, 0) : null,
                active: data?.active !== undefined ? Boolean(data.active) : true,
            };

            if (!payload.sku || !payload.name) {
                return NextResponse.json({ error: "sku y name son obligatorios" }, { status: 400 });
            }

            if (dryRun) {
                return NextResponse.json({ ok: true, action, dryRun: true, payload });
            }

            const created = await prisma.product.create({ data: payload });
            return NextResponse.json({ ok: true, action, created });
        }

        if (action === "createSupplier") {
            const payload = {
                name: String(data?.name || "").trim(),
                email: data?.email ? String(data.email).trim() : null,
                phone: data?.phone ? String(data.phone).trim() : null,
                address: data?.address ? String(data.address).trim() : null,
                city: data?.city ? String(data.city).trim() : null,
                country: data?.country ? String(data.country).trim() : null,
                notes: data?.notes ? String(data.notes).trim() : null,
            };

            if (!payload.name) {
                return NextResponse.json({ error: "name es obligatorio" }, { status: 400 });
            }

            if (dryRun) {
                return NextResponse.json({ ok: true, action, dryRun: true, payload });
            }

            const created = await prisma.supplier.create({ data: payload });
            return NextResponse.json({ ok: true, action, created });
        }

        if (action === "createOrder") {
            const submissionKey = String(data?.idempotencyKey || '').trim();

            if (!submissionKey || submissionKey.length > 160) {
                return NextResponse.json({ error: "idempotencyKey es obligatorio para crear un pedido" }, { status: 400 });
            }

            const previousSubmission = await prisma.orderSubmissionGuard.findUnique({
                where: { submissionKey },
                select: { orderId: true },
            });
            if (previousSubmission) {
                return NextResponse.json({ ok: true, action, created: { id: previousSubmission.orderId }, replayed: true });
            }

            let normalizedOrder;
            try {
                normalizedOrder = canonicalizeAgentOrderItems(data?.items);
                assertAgentProvidedTotal(data?.total_amount, normalizedOrder.totalAmount);
            } catch (error: any) {
                return NextResponse.json({ error: error?.message || 'Los ítems del pedido no son válidos.' }, { status: 400 });
            }

            const payload = {
                clientId: parseNumber(data?.clientId, 0),
                date: toDateOrNow(data?.date),
                status: String(data?.status || "NUEVO").trim(),
                total_amount: normalizedOrder.totalAmount,
                currency: String(data?.currency || "USD").trim(),
                notes: data?.notes ? String(data.notes).trim() : null,
                type: data?.type ? String(data.type).trim() : null,
                paymentMethod: data?.paymentMethod ? String(data.paymentMethod).trim() : null,
                source: data?.source ? String(data.source).trim() : "AGENT",
            };

            if (!payload.clientId) {
                return NextResponse.json({ error: "clientId es obligatorio" }, { status: 400 });
            }

            if (dryRun) {
                return NextResponse.json({
                    ok: true,
                    action,
                    dryRun: true,
                    payload: { ...payload, items: normalizedOrder.items },
                });
            }

            let created;
            try {
                created = await prisma.$transaction(async (tx) => {
                    const lastOrder = await tx.order.findFirst({
                        where: { order_number: { not: null } },
                        orderBy: { order_number: 'desc' },
                        select: { order_number: true },
                    });
                    const orderNumber = (lastOrder?.order_number || 0) + 1;
                    const order = await tx.order.create({
                        data: {
                            ...payload,
                            order_number: orderNumber,
                            items: { create: normalizedOrder.items },
                        },
                    });

                    await tx.orderSubmissionGuard.create({
                        data: { submissionKey, orderId: order.id },
                    });

                    if (normalizedOrder.totalAmount > 0) {
                        await tx.transaction.create({
                            data: {
                                clientId: payload.clientId,
                                date: payload.date,
                                type: 'CARGO',
                                amount: -normalizedOrder.totalAmount,
                                description: `Pedido #${orderNumber}`,
                                reference: `Order #${orderNumber}`,
                            },
                        });
                    }

                    return tx.order.findUnique({
                        where: { id: order.id },
                        include: { items: true },
                    });
                }, { isolationLevel: 'Serializable' });
            } catch (error: any) {
                if (error?.code === 'P2002' || error?.code === 'P2034') {
                    const replayed = await prisma.orderSubmissionGuard.findUnique({
                        where: { submissionKey },
                        select: { orderId: true },
                    });
                    if (replayed) {
                        return NextResponse.json({ ok: true, action, created: { id: replayed.orderId }, replayed: true });
                    }
                    return NextResponse.json({ error: 'Otra operación creó o modificó un pedido al mismo tiempo. Reintentá con la misma idempotencyKey.' }, { status: 409 });
                }
                throw error;
            }

            return NextResponse.json({ ok: true, action, created });
        }

        return NextResponse.json({ error: "Acción no implementada" }, { status: 400 });
    } catch (error) {
        console.error("Agent Action API Error:", error);
        return NextResponse.json({ error: "Ocurrió un error en el servidor" }, { status: 500 });
    }
}
