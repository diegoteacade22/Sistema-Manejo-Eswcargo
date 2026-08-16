# Company OS — Gerente General AI V2

Estado: primer agente AI productivo, autenticado y **read-only**.

## Qué hace

- lee un snapshot agregado de pedidos, productos, compras, envíos, gastos y última sincronización;
- perfila cobertura, frescura, moneda y confianza por métrica antes de consultar al modelo;
- trata gastos cero sin evidencia como brecha de cobertura, no como hecho;
- separa el conteo bruto sin stock del ranking accionable, que exige demanda, margen y disponibilidad verificables;
- construye expedientes `BLOCKED`/`REVIEW` para envíos candidatos con más de 14 días;
- llama OpenAI Responses API con salida JSON Schema estricta;
- concentra un máximo de cinco prioridades;
- organiza planes de misión para Data Quality, Finanzas, Compras, Comercial, Logística y Tecnología, sin afirmar que ya fueron ejecutados;
- expone evidencia, fecha de corte, modelo, response ID y hash del snapshot;
- reserva cada intento en una transacción corta, llama OpenAI fuera de la transacción y guarda el ciclo en una bitácora append-only e idempotente con readback;
- entrega un fallback determinístico identificado si OpenAI no responde.
- permite a un ADMIN aprobar, rechazar, editar, posponer o marcar información incorrecta mediante eventos append-only.

## Qué no hace

- no escribe datos empresariales; solo crea auditoría `CompanyAgentRun`, misiones y decisiones `CompanyAgentMissionEvent`;
- no compra, paga, cambia precios o estados;
- no envía mensajes;
- no despliega ni cambia secretos;
- no presenta una recomendación como acción ejecutada.
- `APPROVED` no ejecuta nada; `RUNNING` y `DONE` son inalcanzables en V2.

## Camino operativo

1. Un administrador abre `/company-os`.
2. Opcionalmente declara el objetivo del ciclo.
3. `POST /api/company-os/brief` autentica una sesión ADMIN revalidada o `COMPANY_OS_API_KEY` exclusiva server-side.
4. El servidor consulta únicamente agregados operativos sin PII.
5. OpenAI sintetiza un brief estructurado y planes de delegación; evidencia, estado, cobertura y guardrails se calculan server-side.
6. Guarda el ciclo, relee el mismo registro y devuelve su ID en `X-Company-OS-Run`.
7. La UI muestra el provider real, perfiles de calidad y misiones persistidas.
8. Las decisiones humanas usan sesión ADMIN, origen same-origin, lock, idempotencia, cadena hash y readback; la clave de máquina recibe `403`.

## Verificación

```bash
cd webapp
npm run test:company-os
npx tsc --noEmit
npm run build
```

La prueba productiva exige sesión ADMIN o `COMPANY_OS_API_KEY` y debe demostrar `execution.provider=openai`, `execution.businessDataReadOnly=true`, un `responseId` real, el mismo `snapshotId` del header `X-Company-OS-Snapshot` y readback del ID `X-Company-OS-Run`.
