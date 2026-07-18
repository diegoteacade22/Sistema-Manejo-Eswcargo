# Etapa 6 - evidencia agotada sin cambio financiero - 2026-07-18

Esta revisión se hizo en modo lectura sobre producción y las fuentes de Google
Drive autorizadas. No se modificó ninguna Google Sheet.

## Cuentas cerradas con fuente concluyente

| Cuenta | Evidencia | Resultado |
| --- | --- | --- |
| Jose JR `#291` | Seis cabeceras de `CABE_ENVIOS` (#1189, #1193, #1197, #1199, #1200 y #1208) suman USD 231.144; los dos pagos existentes suman el mismo importe. | Se crearon los seis cargos de envío con respaldo. Saldo final: USD 0.00. |
| Marcos Roku `#162` | `MARCOS CC` en `CASH FLOW 2026` identifica dos cobros netos y el cargo #2525. | Se conservaron las filas fuente y se retiraron las representaciones duplicadas. |

## Cuentas que no se modifican

| Cuenta | Hecho comprobado | Diferencia | Decisión |
| --- | --- | ---: | --- |
| Nicolas - AudioPhones `#153` | Ventas registra #2310 por USD 10.740 y #2347 por USD 10.800; #2334 está cancelada por USD 0. El sistema conserva un pago de USD 22.248. | USD 708 | No modificar. No hay recibo, Invoice ni movimiento financiero en las fuentes históricas consultadas que explique el importe. |
| Nicolas Iphone Bsas `#197` | Venta #2421 por USD 9.370, cancelada. El sistema conserva un pago de arqueo inicial por USD 9.674. | USD 304 | No modificar. La venta cancelada no permite transformar el arqueo en un cargo ni justificar la diferencia. |
| Franco Pepe `#84` | El movimiento `#417888` es un `PAGO` de USD -21.001,80 del 19/04/2026, sin referencia. Las ventas históricas localizadas no coinciden en fecha ni importe. | Signo y comprobante ausentes | No modificar. Requiere recibo o Invoice que identifique el caso. |
| Claudio Molina x IG `#261` | El movimiento `#454256` es un `PAGO` de USD -76.000 del 06/05/2026, sin referencia. La conversación encontrada habla de conciliar la cuenta, pero no acredita ese importe ni su signo. | Signo y comprobante ausentes | No modificar. Requiere recibo, Invoice o planilla del cliente que vincule fecha e importe. |
| Ciro Dapero `#210` | El respaldo histórico `VENTAS COMPRAS 2023 al 2025` registra la venta #2119 por USD 66.319, con USD 66.139 pagados y saldo USD -180 al 15/09/2025. La apertura histórica de producción es USD 66.332. | USD 193 y falta de trazabilidad desde la venta al ajuste de apertura | No modificar. El respaldo comercial no justifica el importe exacto de la apertura ni su signo contable. |

## Fuentes consultadas

- `VENTAS - COMPRAS 2025-2026`: pedidos, estados e importes comerciales.
- `CASH FLOW 2026`: fuente financiera vigente; no incluye una cuenta fuente
  para los dos casos pendientes.
- `CASH FLOW 2025`, `VENTAS COMPRAS 2023 al 2025` y los respaldos históricos
  localizados en Drive: las búsquedas dirigidas no hallaron un comprobante
  financiero individual para los dos movimientos indicados.
- Para Ciro Dapero se encontró actividad comercial histórica, pero no un
  comprobante que explique la diferencia de USD 193 contra su apertura en
  producción; por eso tampoco se aplicó una corrección.

## Hallazgos de consistencia histórica

- Los 54 ajustes con referencia `CC-ZERO-BASELINE-2026:*` son aperturas de
  migración: todos están fechados el 01/01/2026, comparten la misma
  descripción genérica y fueron creados en dos ejecuciones posteriores de
  mayo y junio. No son comprobantes originales ni una fuente válida para
  reconstruir movimientos.
- `CTA JORGE` contiene en realidad una cuenta de Facu Fabricini: el título de
  pestaña no identifica de forma fiable al titular.
- `CUENTA AUGUSTO` cierra en USD 331 el 27/10/2025, mientras el ajuste de
  inicio de Augusto en el sistema es USD 7.205,40.
- Las cuentas históricas de Lucas Cly terminan en importes distintos de su
  ajuste de inicio en producción. Ninguna de estas diferencias se convirtió en
  movimiento de ESWCARGO porque no existe una correspondencia completa de
  cliente, fecha, documento e importe.

Para cualquier corrección futura se necesita adjuntar un Invoice, recibo,
comprobante bancario o confirmación comercial verificable al caso exacto en el
centro de evidencia. Hasta entonces, la cuenta queda preservada y visible en la
cola de revisión.
