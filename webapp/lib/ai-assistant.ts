
import { GoogleGenerativeAI } from "@google/generative-ai";
import { prisma } from "./prisma";

const genAI = new GoogleGenerativeAI((process.env.GEMINI_API_KEY || "").trim());

export async function processAiQuery(prompt: string, userRole: string, userId: string) {
    // 0. Check Environment - DISABLE IN PRODUCTION
    const isProduction = process.env.NEXT_PUBLIC_VERCEL_ENV === 'production';
    if (isProduction) {
        return "🚀 ¡Próximamente seré tu Copiloto Financiero e Inteligente! Actualmente estoy en fase de entrenamiento para brindarte el mejor servicio. ¡Mantente atento!";
    }

    if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY.trim() === "") {
        return "El asistente IA no está configurado. Por favor, agrega GEMINI_API_KEY al entorno.";
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

    const model = genAI.getGenerativeModel({
        model: "gemini-flash-latest",
        systemInstruction: `Eres el Asistente Inteligente de Eswcargo. Tu objetivo es ayudar a ${userRole === 'ADMIN' ? 'los administradores' : 'los clientes'} a analizar sus datos de importación y finanzas.
        
        REGLAS CRÍTICAS:
        1. ${userRole === 'CLIENT' ? 'ESTRICTAMENTE SOLO puedes responder sobre el cliente con ID ' + clientId + '. No menciones otros clientes ni datos globales.' : 'Eres el administrador, puedes ver todo el sistema.'}
        2. Siempre responde en español, de forma profesional pero cercana.
        3. Si no tienes datos suficientes para responder, admítelo e indica qué falta.
        4. No inventes datos. Usa exclusivamente la información proporcionada por las herramientas.
        
        ESTRUCTURA DE DATOS:
        - Clientes: Tienen ID, nombre, email, teléfono y saldo acumulado.
        - Pedidos: Tienen número de pedido, fecha, estado (PENDIENTE, ENTREGADO, etc) y monto total.
        - Transacciones: Registro de pagos (PAGO) y cargos (CARGO). El saldo es la suma de estos.
        - Envíos: Nro de envío, fecha, estado y forwarder.
        `
    });

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
        const result = await model.generateContent([
            context,
            `PREGUNTA DEL USUARIO: ${prompt}`
        ]);
        const response = await result.response;
        return response.text();
    } catch (error: any) {
        console.error("AI Error:", error);
        return "Lo siento, hubo un error procesando tu consulta con la IA: " + error.message;
    }
}
