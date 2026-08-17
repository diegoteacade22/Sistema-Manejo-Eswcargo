import { processAiQuery } from "@/lib/ai-assistant";
import { verifyAgentRequest } from "@/lib/agent-auth";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
    try {
        const rawBody = await req.text();
        if (!verifyAgentRequest(req, rawBody)) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        const body = JSON.parse(rawBody);
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
