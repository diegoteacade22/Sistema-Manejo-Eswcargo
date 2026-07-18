# Auditoria de referencias Invoice - 2026-07-18

## Alcance

- Lectura exclusiva de las 11 cuentas de `CASH FLOW 2026` y de
  `CABE_VENTAS` en `VENTAS - COMPRAS 2025-2026`.
- No se modificaron planillas, pedidos, pagos ni movimientos de ESWCARGO.
- La auditoria de produccion separada confirma cero duplicados exactos de
  cargos o pagos en el sistema.

## Resultado de la fuente

| Situacion | Referencias Invoice |
| --- | ---: |
| Cliente e importe coinciden con la venta | 157 |
| Venta historica con total cero, no verificable | 96 |
| Importe distinto a la venta | 15 |
| Cliente distinto al de la venta | 5 |
| Invoice no existente en `CABE_VENTAS` | 1 |

Hay 136 filas donde la variacion de saldo no coincide con el importe escrito
en la misma fila. Se conservan como advertencia de estructura historica: no se
puede inferir un pago o cargo solo a partir de esa diferencia.

## Candidato de cargo repetido

- Luca Sta Fe Nahuel (`#214`), `INV #2352`:
  - `LUCA CC!37`: USD 9.000.
  - `LUCA CC!43`: USD 1.265.
  - `CABE_VENTAS!213`: venta USD 1.265.

La referencia se repite con dos cargos y solo una venta verificable. El cargo
de USD 9.000 no se elimina ni reasigna: la planilla no identifica el documento
real al que corresponde.

## Diferencias que requieren correccion de fuente o respaldo documental

- Importe distinto: Marcos `#2288`, `#2357`, `#2467`, `#2510`, `#2548`; Aylen
  `#2270`, `#2275`, `#2294`, `#2419`; Facu `#2282`; Luca `#2280`, `#2287`,
  `#2349` y las dos filas de `#2352`.
- Cliente distinto: Marcos `#2131`; Aylen `#2284`; Facu `#2175` y `#2484`;
  Luca `#2232`.
- Sin venta en la fuente: Aylen `#2641`, USD 45.200.

## Regla aplicada

El contraste corre en modo lectura al inicio de cada sincronizacion local o
cloud. Solo alerta; nunca crea, borra, invierte ni reasigna cargos o pagos.
Una correccion futura debe respaldar el movimiento, identificar el documento
correcto y mantener conciliado el saldo final de la cuenta.
