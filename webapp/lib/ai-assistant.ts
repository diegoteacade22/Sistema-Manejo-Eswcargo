
import { GoogleGenerativeAI } from "@google/generative-ai";
import { prisma } from "./prisma";

let geminiKeyInvalidDetected = false;

function getApiKey(): string {
    return (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "").trim();
}

function getCandidateModels(): string[] {
    const configured = (process.env.GEMINI_MODEL || "").trim();
    const candidates = [configured, "gemini-2.0-flash", "gemini-1.5-flash"].filter(Boolean);
    return [...new Set(candidates)];
}

function isGeminiKeyInvalidError(error: unknown): boolean {
    if (!error) return false;
    const text = typeof error === "string"
        ? error
        : error instanceof Error
            ? `${error.message} ${JSON.stringify((error as any).errorDetails || {})}`
            : JSON.stringify(error);

    const normalized = text.toLowerCase();
    return normalized.includes("api_key_invalid")
        || normalized.includes("api key expired")
        || normalized.includes("api key not valid");
}

function formatUsd(value: number): string {
    return new Intl.NumberFormat("es-AR", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 2,
    }).format(value || 0);
}

function startOfToday(): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

async function buildFallbackResponse(prompt: string, userRole: string, userId: string): Promise<string> {
    const normalizedPrompt = prompt.toLowerCase();

    if (userRole === "CLIENT") {
        const client = await (prisma.client as any).findFirst({
            where: { userId },
            include: {
                orders: { orderBy: { date: "desc" }, take: 10 },
                transactions: { orderBy: { date: "desc" }, take: 30 },
            },
        });

        if (!client) {
            return "No encontré un cliente vinculado a tu usuario. Si querés, reviso la vinculación ahora.";
        }

        const balance = (client.transactions || []).reduce((acc: number, tx: any) => acc + (tx.amount || 0), 0);
        const today = startOfToday();
        const billedToday = (client.orders || [])
            .filter((order: any) => new Date(order.date) >= today)
            .reduce((acc: number, order: any) => acc + (order.total_amount || 0), 0);

        if (normalizedPrompt.includes("hoy") && (normalizedPrompt.includes("factur") || normalizedPrompt.includes("venta"))) {
            return `Hoy facturaste ${formatUsd(billedToday)}. Tu saldo actual es ${formatUsd(balance)}.`;
        }

        if (normalizedPrompt.includes("saldo") || normalizedPrompt.includes("deuda") || normalizedPrompt.includes("deudor")) {
            return `Tu saldo actual es ${formatUsd(balance)}. Si querés, te detallo tus últimos movimientos y pedidos.`;
        }

        return [
            `Resumen rápido de tu cuenta (${client.name}):`,
            `• Saldo actual: ${formatUsd(balance)}`,
            `• Pedidos recientes: ${(client.orders || []).length}`,
            `• Facturación de hoy: ${formatUsd(billedToday)}`,
            "Puedo responder también por pedidos, envíos, pagos o pendientes.",
        ].join("\n");
    }

    const today = startOfToday();
    const todayOrders = await prisma.order.aggregate({
        where: { date: { gte: today } },
        _sum: { total_amount: true },
        _count: { id: true },
    });

    const recentOrders = await prisma.order.count({
        where: { date: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
    });

    const debtorGroups = await prisma.transaction.groupBy({
        by: ["clientId"],
        where: { clientId: { not: null } },
        _sum: { amount: true },
    });

    const topDebtorGroups = debtorGroups
        .filter((row) => (row._sum.amount || 0) > 0)
        .sort((a, b) => (b._sum.amount || 0) - (a._sum.amount || 0))
        .slice(0, 3);

    const topDebtorIds = topDebtorGroups
        .map((row) => row.clientId)
        .filter((id): id is number => typeof id === "number");

    const topDebtors = topDebtorIds.length
        ? await prisma.client.findMany({ where: { id: { in: topDebtorIds } }, select: { id: true, name: true } })
        : [];

    const debtorMap = new Map<number, string>();
    for (const client of topDebtors) debtorMap.set(client.id, client.name);

    const debtorsText = topDebtorGroups.length
        ? topDebtorGroups
            .map((row) => `• ${debtorMap.get(row.clientId as number) || `Cliente #${row.clientId}`}: ${formatUsd(row._sum.amount || 0)}`)
            .join("\n")
        : "• No hay deudores con saldo positivo en este momento.";

    if (normalizedPrompt.includes("hoy") && (normalizedPrompt.includes("factur") || normalizedPrompt.includes("venta"))) {
        return `Hoy se facturó ${formatUsd(todayOrders._sum.total_amount || 0)} en ${todayOrders._count.id} pedido(s).`;
    }

    if (normalizedPrompt.includes("deud") || normalizedPrompt.includes("saldo")) {
        return `Top de deudores actuales:\n${debtorsText}`;
    }

    return [
        "Resumen rápido del sistema:",
        `• Facturación de hoy: ${formatUsd(todayOrders._sum.total_amount || 0)} (${todayOrders._count.id} pedidos)`,
        `• Pedidos últimos 7 días: ${recentOrders}`,
        "• Top deudores:",
        debtorsText,
    ].join("\n");
}

export async function processAiQuery(prompt: string, userRole: string, userId: string) {
    const apiKey = getApiKey();

    if (geminiKeyInvalidDetected || !apiKey) {
        return buildFallbackResponse(prompt, userRole, userId);
    }

    // 1. Identify Client if not Admin
    let clientId: number | null = null;
    if (userRole === 'CLIENT') {
        const client = await (prisma.client as any).findFirst({
            where: { userId: userId },
            select: { id: true, name: true }
        });
        if (!client) return "No se encontró un registro de cliente vinculado a tu usuario.";
        clientId = client.id;
    }

    // We'll use a "Contextual Data Fetch" approach instead of pure function calling for now to keep it simple and fast.
    // Fetch relevant context based on key terms in the prompt.
    let context = "CONTEXTO ACTUAL:\n";

    if (userRole === 'ADMIN') {
        // Broad context for Admin
        if (prompt.toLowerCase().includes('cliente') || prompt.toLowerCase().includes('deud') || prompt.toLowerCase().includes('factura')) {
            const topClients = await prisma.client.findMany({ take: 20 });
            context += "--- Clientes (Top 20) ---\n" + JSON.stringify(topClients.map(c => ({ id: c.id, name: c.name, email: c.email }))) + "\n";

            const debtors = await prisma.transaction.groupBy({
                by: ['clientId'],
                _sum: { amount: true },
                having: { amount: { _sum: { gt: 10 } } },
                orderBy: { _sum: { amount: 'desc' } },
                take: 10
            });
            context += "--- Principales Deudores ---\n" + JSON.stringify(debtors) + "\n";
        }

        if (prompt.toLowerCase().includes('pedido') || prompt.toLowerCase().includes('venta')) {
            const recentOrders = await prisma.order.findMany({
                orderBy: { date: 'desc' },
                take: 20,
                include: { client: { select: { name: true } } }
            });
            context += "--- Pedidos Recientes ---\n" + JSON.stringify(recentOrders) + "\n";
        }
    } else {
        // Restricted context for Client
        const myClient = await prisma.client.findUnique({
            where: { id: clientId! },
            include: {
                orders: { orderBy: { date: 'desc' }, take: 10 },
                transactions: { orderBy: { date: 'desc' }, take: 10 }
            }
        });
        context += "--- Mis Datos de Cliente ---\n" + JSON.stringify(myClient) + "\n";

        const balance = await prisma.transaction.aggregate({
            where: { clientId: clientId! },
            _sum: { amount: true }
        });
        context += "--- Mi Saldo Pendiente: " + (balance._sum.amount || 0) + " USD ---\n";
    }

    try {
        if (!apiKey) {
            return buildFallbackResponse(prompt, userRole, userId);
        }

        const genAI = new GoogleGenerativeAI(apiKey);
        const models = getCandidateModels();

        let lastError: unknown = null;
        for (const modelName of models) {
            try {
                const model = genAI.getGenerativeModel({
                    model: modelName,
                    systemInstruction: `Eres el Asistente Inteligente de Eswcargo. Tu objetivo es ayudar a ${userRole === 'ADMIN' ? 'los administradores' : 'los clientes'} a analizar sus datos de importación y finanzas.
                    
                    REGLAS CRÍTICAS:
                    1. ${userRole === 'CLIENT' ? 'ESTRICTAMENTE SOLO puedes responder sobre el cliente con ID ' + clientId + '. No menciones otros clientes ni datos globales.' : 'Eres el administrador, puedes ver todo el sistema.'}
                    2. Siempre responde en español, de forma profesional pero cercana.
                    3. Si no tienes datos suficientes para responder, admítelo e indica qué falta.
                    4. No inventes datos. Usa exclusivamente la información proporcionada por las herramientas.
                    `,
                });

                const result = await model.generateContent([
                    context,
                    `PREGUNTA DEL USUARIO: ${prompt}`,
                ]);
                const response = await result.response;
                const text = response.text();
                if (text && text.trim().length > 0) {
                    return text;
                }
            } catch (modelError) {
                if (isGeminiKeyInvalidError(modelError)) {
                    geminiKeyInvalidDetected = true;
                    return buildFallbackResponse(prompt, userRole, userId);
                }
                lastError = modelError;
            }
        }

        if (lastError) {
            console.error("AI Error (all models failed):", lastError);
        }
        return buildFallbackResponse(prompt, userRole, userId);
    } catch (error: any) {
        console.error("AI Error:", error);
        return buildFallbackResponse(prompt, userRole, userId);
    }
}
