import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

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
            const items = Array.isArray(data?.items) ? data.items : [];

            const payload = {
                clientId: parseNumber(data?.clientId, 0),
                date: toDateOrNow(data?.date),
                status: String(data?.status || "NUEVO").trim(),
                total_amount: parseNumber(data?.total_amount, 0),
                currency: String(data?.currency || "USD").trim(),
                notes: data?.notes ? String(data.notes).trim() : null,
                type: data?.type ? String(data.type).trim() : null,
                paymentMethod: data?.paymentMethod ? String(data.paymentMethod).trim() : null,
                source: data?.source ? String(data.source).trim() : "AGENT",
            };

            if (!payload.clientId) {
                return NextResponse.json({ error: "clientId es obligatorio" }, { status: 400 });
            }

            const normalizedItems = items.map((item: any) => ({
                productId: item?.productId ? parseNumber(item.productId, 0) : null,
                productName: String(item?.productName || "Item").trim(),
                quantity: parseNumber(item?.quantity, 1),
                unit_price: parseNumber(item?.unit_price, 0),
                unit_cost: parseNumber(item?.unit_cost, 0),
                subtotal: parseNumber(item?.subtotal, parseNumber(item?.quantity, 1) * parseNumber(item?.unit_price, 0)),
                supplierId: item?.supplierId ? parseNumber(item.supplierId, 0) : null,
                status: item?.status ? String(item.status).trim() : null,
            }));

            if (dryRun) {
                return NextResponse.json({
                    ok: true,
                    action,
                    dryRun: true,
                    payload: { ...payload, items: normalizedItems },
                });
            }

            const created = await prisma.$transaction(async (tx) => {
                const order = await tx.order.create({
                    data: payload,
                });

                if (normalizedItems.length > 0) {
                    await tx.orderItem.createMany({
                        data: normalizedItems.map((item: any) => ({
                            ...item,
                            orderId: order.id,
                        })),
                    });
                }

                const fullOrder = await tx.order.findUnique({
                    where: { id: order.id },
                    include: { items: true },
                });

                return fullOrder;
            });

            return NextResponse.json({ ok: true, action, created });
        }

        return NextResponse.json({ error: "Acción no implementada" }, { status: 400 });
    } catch (error) {
        console.error("Agent Action API Error:", error);
        return NextResponse.json({ error: "Ocurrió un error en el servidor" }, { status: 500 });
    }
}
