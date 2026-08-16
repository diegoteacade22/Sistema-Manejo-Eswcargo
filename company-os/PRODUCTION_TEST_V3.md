# Prueba productiva controlada V3

Ejecutar una sola vez, mediante sesión ADMIN:

> Analizá el estado actual de Company OS, identificá el principal problema de calidad de datos y proponé un próximo paso. No ejecutes ninguna acción.

Readback obligatorio:

- `QUEUED → ANALYZING → AWAITING_REVIEW` o `COMPLETED`;
- orden y resultado visibles en el hilo;
- heartbeat y consumo separados;
- evento append-only y referencias de evidencia válidas;
- Telegram `DELIVERED`;
- segundo claim con el mismo `requestId` devuelve `204`;
- caso de prueba con webhook fallido es reclamado por recovery sin intervención;
- snapshot de permisos y auditoría confirma cero escrituras en tablas empresariales.

