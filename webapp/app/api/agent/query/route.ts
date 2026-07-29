import { processAiQuery } from "@/lib/ai-assistant";
import { NextResponse } from "next/server";

function getExpectedApiKey() {
    return (process.env.AGENT_API_KEY || "").trim();
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
        const message = typeof body?.message === "string" ? body.message.trim() : "";
        const role = body?.role === "CLIENT" ? "CLIENT" : "ADMIN";
        const userId = typeof body?.userId === "string" && body.userId.trim() ? body.userId.trim() : "agent-api";

        if (!message) {
            return NextResponse.json({ error: "message requerido" }, { status: 400 });
        }

        if (role === "CLIENT" && userId === "agent-api") {
            return NextResponse.json({ error: "userId requerido para role CLIENT" }, { status: 400 });
        }

        const response = await processAiQuery(message, role, userId);

        return NextResponse.json({ response });
    } catch (error) {
        console.error("Agent API Error:", error);
        return NextResponse.json({ error: "Ocurrió un error en el servidor" }, { status: 500 });
    }
}
