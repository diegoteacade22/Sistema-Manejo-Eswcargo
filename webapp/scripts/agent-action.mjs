#!/usr/bin/env node

const [action, jsonData = "{}", dryRunArg = "false"] = process.argv.slice(2);

if (!action) {
    console.error("Uso: node scripts/agent-action.mjs <action> '<jsonData>' [dryRun]");
    process.exit(1);
}

let data;
try {
    data = JSON.parse(jsonData);
} catch {
    console.error("jsonData inválido. Ejemplo: '{\"name\":\"Cliente Demo\"}'");
    process.exit(2);
}

const endpoint = process.env.AGENT_ACTION_API_URL || "http://localhost:3000/api/agent/action";
const apiKey = (process.env.AGENT_API_KEY || "").trim();
const dryRun = ["1", "true", "yes", "on"].includes(String(dryRunArg).toLowerCase());

if (!apiKey) {
    console.error("Falta AGENT_API_KEY en variables de entorno.");
    process.exit(3);
}

try {
    const response = await fetch(endpoint, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            "x-agent-key": apiKey,
        },
        body: JSON.stringify({ action, data, dryRun }),
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
        process.exit(4);
    }

    process.stdout.write(JSON.stringify(payload, null, 2));
    process.stdout.write("\n");
} catch (error) {
    console.error("Error de conexión:", error instanceof Error ? error.message : String(error));
    process.exit(5);
}
