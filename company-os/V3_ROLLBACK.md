# Rollback Company OS V3

El rollback de aplicación no elimina datos ni revierte la migración forward-only.

1. Deshabilitar el formulario V3 apuntando el deployment Vercel al commit anterior verificado.
2. Detener `company-os-v3-worker.service` y `company-os-v3-recover.timer`; conservar logs, tablas y archivo de entorno.
3. Confirmar que no quedan leases activos; marcarlos `EXPIRED` sólo mediante una migración de incidente aprobada.
4. Verificar que Company OS V2 continúa disponible y que no hubo escrituras empresariales.
5. Para reactivar, restaurar el deployment V3, comprobar HMAC/health y habilitar servicio + timer.

Nunca hacer `DROP`, reset, borrado de eventos ni rollback destructivo de Supabase. Las tablas V3 permanecen como evidencia auditable.

