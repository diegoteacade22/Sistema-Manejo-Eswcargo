# Colisiones de Fuente - 2026-07-18

## Regla aplicada

La sincronizacion conserva los datos productivos existentes cuando la fuente
contiene dos cabeceras incompatibles para la misma clave. No se selecciona una
fila por orden de lectura. Los articulos y asignaciones verificables continúan
auditandose normalmente.

## Envíos que requieren corrección manual en `CABE_ENVIOS`

- `#1217`
- `#1204`
- `#1207`
- `#1188`
- `#1094`
- `#972`
- `#931`
- `#862`
- `#689`
- `#662`
- `#659`
- `#555`
- `#383`

Cada número contiene dos filas con cliente, peso o importes incompatibles.
Debe quedar una única cabecera por número, o definirse un modelo de envío
compartido antes de automatizar esa consolidación.

## Pedido que requiere corrección manual en `CABE_VENTAS`

- `#2223`

Existen dos cabeceras con clientes distintos para el mismo pedido. La
sincronización no actualiza su cabecera hasta que se defina la fila correcta.

## Verificación posterior

La corrida cloud validada registró las 14 excepciones, sin actualizaciones
operativas repetidas, sin reemplazos de ítems y sin crear movimientos de cuenta
corriente. Packing, Invoice y asignaciones permanecieron auditados correctamente.
