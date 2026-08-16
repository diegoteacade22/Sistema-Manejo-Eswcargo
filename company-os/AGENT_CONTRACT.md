# Contrato — `general-manager-ai-v3`

- Fuente: datos empresariales estrictamente read-only, sin PII en el snapshot materializado.
- Autoridad: advisory-only; ninguna recomendación equivale a ejecución.
- OpenAI: Responses API, `store=false`, evidencia cerrada y salida JSON Schema estricta.
- Aprobación humana: obligatoria; aprobar una misión no autoriza ejecutarla.
- Eventos: append-only con secuencia, hash previo, idempotencia y readback.
- Evidencia: referencias materializadas antes de la llamada al modelo.
- Calidad: control determinístico de cobertura, frescura, moneda y confianza; cero invenciones.
- Entrega: persist-before-deliver, webhook HMAC, recovery cada minuto, lock y lease durable por `requestId`.
- Estados de solicitudes: `QUEUED`, `ANALYZING`, `AWAITING_REVIEW`, `BLOCKED`, `FAILED`, `CANCELLED`, `COMPLETED`.
- Estados de misiones: `PLANNED`, `APPROVED`, `REJECTED`, `REVIEW`, `BLOCKED`, `RUNNING`, `DONE`; V3 no puede alcanzar `RUNNING` ni `DONE`.
- Escrituras permitidas: exclusivamente casos, mensajes, eventos, decisiones, auditoría, consumo, locks, leases, heartbeats, intentos de ejecución, entregas de notificaciones, misiones y referencias de evidencia de Company OS.
- Escrituras prohibidas: todas las tablas operativas empresariales, Sheets, Supabase operativo y servicios externos salvo la notificación Telegram autorizada.
- Infraestructura: Vercel + Supabase + Hostinger/OpenClaw. AWS está archivado y fuera de alcance.
