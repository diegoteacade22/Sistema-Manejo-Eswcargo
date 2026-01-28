
import { auth } from "@/lib/auth";
import { processAiQuery } from "@/lib/ai-assistant";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
    const session = await auth();
    if (!session?.user) {
        return new NextResponse("Unauthorized", { status: 401 });
    }

    try {
        const { message } = await req.json();
        const userRole = (session.user as any).role;
        const userId = (session.user as any).id;

        const response = await processAiQuery(message, userRole, userId);

        return NextResponse.json({ response });
    } catch (error: any) {
        console.error("API AI Error:", error);
        return NextResponse.json({ error: "Ocurrió un error en el servidor" }, { status: 500 });
    }
}
