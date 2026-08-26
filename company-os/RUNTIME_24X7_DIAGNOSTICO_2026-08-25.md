# Diagnóstico inicial — Runtime Company OS 24/7

Fecha: 2026-08-25  
Zona horaria: `America/New_York`  
Base auditada: `origin/main` en `3baee54`  
Rama aislada: `codex/company-os-runtime-24x7`

## Resultado del diagnóstico read-only

Company OS V3 ya aporta una base productiva reutilizable: casos, mensajes,
eventos append-only, evidencia, misiones, decisiones humanas, consumo, locks,
leases, heartbeats por intento, intentos de ejecución, notificaciones y agenda
por `agentId`. El Gerente General y el Gerente de Sistemas tienen contratos y
recorridos ejecutables; el runtime mantiene autoridad advisory-only.

El sistema todavía no satisface el encargo 24/7 en DiegoServer:

- `webapp/company-os-worker` está documentado y empaquetado para Hostinger con
  `systemd`; no existe un servicio Company OS genérico instalado mediante
  `launchd` en la Mac mini.
- `company-os/diegoserver-worker` es otro producto: consume issues de GitHub y
  ejecuta Codex en un clon aislado. No consume la cola durable de Company OS.
- El heartbeat actual pertenece a un lease/caso activo; no prueba que un worker
  esté vivo cuando la cola está vacía.
- El mensaje común no declara todavía origen/destino de agente, correlación,
  causalidad, entrega, deduplicación, respuesta esperada ni expiración.
- El contrato de agente sólo registra nombre, área y superior. Faltan triggers,
  fuentes, allow/deny de herramientas y tablas, timeout, concurrencia,
  presupuestos, política de baja confianza y esquemas versionados.
- Los estados de caso V3 no separan aún `CLAIMED`, `RUNNING`,
  `FAILED_RETRYABLE` y `FAILED_FINAL`; la UI no debe inferir actividad de un
  estado histórico.
- No hay una identidad durable de worker con estado `STARTING | IDLE | BUSY |
  DEGRADED | DRAINING | STOPPED | UNKNOWN`, versión, host, inicio y trabajo
  actual visibles desde Company OS.
- No existe una prueba vigente de dos workers reclamando atómicamente el mismo
  caso, recuperación tras matar el proceso de DiegoServer ni reinicio por
  `launchd` de este runtime.

## Decisiones de compatibilidad

1. Extender las primitivas V3 mediante columnas/tablas aditivas y adaptadores;
   no crear un segundo plano de control.
2. Mantener Supabase/Postgres como fuente de verdad y Vercel como API/UI.
3. Ejecutar un único worker Node.js/TypeScript en DiegoServer. El worker no
   llama modelos cuando no obtiene un claim válido.
4. Registrar sólo agentes con handler ejecutable. El resto se mostrará como
   `NOT_INSTALLED`, no como activo ni offline.
5. Mantener todos los agentes advisory-only y sin DML sobre tablas
   empresariales.
6. No modificar AWS, Hostinger ni OpenClaw. Cualquier adaptador opcional quedará
   deshabilitado salvo evidencia actual de un puente seguro ya existente.

## Evidencia exigida para cerrar

La implementación no se considerará terminada por código, build o HTTP 200.
Debe probar: migración reversible aplicada; claim atómico; leases renovados y
recuperados; cero llamadas con cola vacía; reinicio controlado por `launchd`;
heartbeat ocioso reciente; caso manual inocuo completo; hilo agente-agente;
consumo visible; cola final vacía; autenticación y pruebas negativas; y cero
escrituras en tablas empresariales.

Este documento registra el estado anterior a cualquier modificación funcional.
Se completará con referencias exactas y resultados de producción durante la
implementación.
