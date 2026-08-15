# Company OS — Gerente General AI v1

Estado: primer agente AI productivo, autenticado y **read-only**.

## Qué hace

- lee un snapshot agregado de pedidos, productos, compras, envíos, gastos y última sincronización;
- llama OpenAI Responses API con salida JSON Schema estricta;
- concentra un máximo de cinco prioridades;
- organiza misiones para Data Quality, Finanzas, Compras, Comercial, Logística y Tecnología;
- expone evidencia, fecha de corte, modelo, response ID y hash del snapshot;
- guarda cada ciclo en una bitácora append-only e idempotente y verifica el readback;
- entrega un fallback determinístico identificado si OpenAI no responde.

## Qué no hace

- no escribe datos empresariales; solo crea su registro de auditoría `CompanyAgentRun` y las misiones `CompanyAgentMission` asociadas;
- no compra, paga, cambia precios o estados;
- no envía mensajes;
- no despliega ni cambia secretos;
- no presenta una recomendación como acción ejecutada.

## Camino operativo

1. Un administrador abre `/company-os`.
2. Opcionalmente declara el objetivo del ciclo.
3. `POST /api/company-os/brief` autentica una sesión ADMIN revalidada o `COMPANY_OS_API_KEY` exclusiva server-side.
4. El servidor consulta únicamente agregados operativos sin PII.
5. OpenAI sintetiza un brief estructurado y delegaciones.
6. Guarda el ciclo, relee el mismo registro y devuelve su ID en `X-Company-OS-Run`.
7. La UI muestra el provider real, el modelo, la fecha de corte y el snapshot.

## Verificación

```bash
cd webapp
npm run test:company-os
npx tsc --noEmit
npm run build
```

La prueba productiva exige sesión ADMIN o `COMPANY_OS_API_KEY` y debe demostrar `execution.provider=openai`, `execution.businessDataReadOnly=true`, un `responseId` real, el mismo `snapshotId` del header `X-Company-OS-Snapshot` y readback del ID `X-Company-OS-Run`.
