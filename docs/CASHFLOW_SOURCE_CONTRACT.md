# Contrato de fuentes: Ventas, cuenta corriente y Cash Flow

## Fuente operativa: Ventas y Compras

La planilla operativa de Ventas y Compras es la unica fuente automatica para
pedidos, items, asignaciones a envio, packing list, invoice y movimientos
derivados. La sincronizacion reemplaza los items de un pedido dentro de una
transaccion y conserva los registros cuando la fuente no se pudo descargar.

## Cuenta corriente

Las pestanas de cuenta corriente de Cash Flow son una fuente de consulta y
reconciliacion. No se importan de forma automatica. Las importaciones legacy
`CC-Import-*` permanecen bloqueadas por defecto para evitar duplicaciones o
alterar saldos existentes.

## Cash Flow

`CASH DIARIO` es una foto de caja. `PROXIMOS VENCIMIENTOS` es una agenda de
compromisos. Ambas se auditan sin escritura. Las pestanas personales o no
normalizadas no participan de ningun proceso automatico hasta definir su
estructura y responsable.

## Regla de seguridad

Una alerta de Cash Flow nunca bloquea ni modifica la sincronizacion operativa.
La auditoria informa pestanas faltantes y errores de formula; no corrige
valores, no borra filas y no actualiza la base de datos.
