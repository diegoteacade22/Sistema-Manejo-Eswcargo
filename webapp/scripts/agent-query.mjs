#!/usr/bin/env node

const args = process.argv.slice(2);
const message = args.join(" ").trim();

if (!message) {
    console.error("Uso: node scripts/agent-query.mjs \"tu consulta\"");
    process.exit(1);
}

const endpoint = process.env.AGENT_API_URL || "http://localhost:3000/api/agent/query";
const apiKey = (process.env.AGENT_API_KEY || "").trim();
const role = (process.env.AGENT_ROLE || "ADMIN").trim().toUpperCase();
const userId = (process.env.AGENT_USER_ID || "agent-api").trim();

if (!apiKey) {
    console.error("Falta AGENT_API_KEY en variables de entorno.");
    process.exit(2);
}

try {
    const response = await fetch(endpoint, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            "x-agent-key": apiKey,
        },
        body: JSON.stringify({ message, role, userId }),
    });

    const text = await response.text();
    let payload;
    try {
        payload = JSON.parse(text);
    } catch {
        payload = { raw: text };
    }

    if (!response.ok) {
        console.error(`Error ${response.status}: ${payload.error || payload.raw || "Error desconocido"}`);
        process.exit(3);
    }

    process.stdout.write(String(payload.response ?? ""));
    process.stdout.write("\n");
} catch (error) {
    console.error("Error de conexión:", error instanceof Error ? error.message : String(error));
    process.exit(4);
}
