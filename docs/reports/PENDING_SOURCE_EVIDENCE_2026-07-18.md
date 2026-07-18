# Excepciones que requieren respaldo documental - 2026-07-18

Este reporte se generó en modo lectura. No se modificó ninguna Google Sheet ni
movimiento financiero del sistema.

## Packing #1048

El número no aparece en `CABE_ENVIOS` ni en `DETA_VENTAS` de
`VENTAS - COMPRAS 2025-2026`, ni en el índice de envíos del histórico
`VENTAS COMPRAS 2023 al 2025`. No existe fuente verificable para reconstruir
artículos, cliente o importe. El Packing, PDF y email deben continuar
bloqueados.

## Pedido #2223

`CABE_VENTAS` contiene dos filas incompatibles para el mismo Invoice:

| Cliente | ID | Fecha | Total |
| --- | ---: | --- | ---: |
| Aylen Gentiletti | 70 | 12/01/2025 | USD 10.320 |
| Lucas Cly Store | 151 | 12/01/2025 | USD 10.320 |

No existe criterio documental para elegir una cabecera. El pedido se mantiene
bloqueado hasta corregir la fuente.

## Cuenta Luca - Invoice #2352

`LUCA CC` contiene dos cargos con la misma referencia: USD 9.000 el
12/02/2026 y USD 1.265 el 25/02/2026. La copia histórica
`VENTAS COMPRAS 2023 al 2025 Para Sistema en Gemini_backup.xlsx`, pestaña
`LUCA CC`, registra ambos cargos. La referencia compartida se deja visible como
revisión documentada, pero no se trata como duplicado comprobado ni se elimina
ninguno.

## Cuentas corrientes con alerta de signo

Quedan dos pagos históricos con signo opuesto a su tipo: Franco Pepe
`#84` (USD -21.001,80) y Claudio Molina x IG `#261` (USD -76.000). No tienen
recibo, comprobante bancario ni fuente financiera vigente que permita invertir
o eliminar el movimiento. Se conservan sin cambio hasta adjuntar evidencia.

## Cash Flow y proveedores

- `PROXIMOS VENCIMIENTOS` mantiene errores de fórmula en `Z2`, `Z3` y en el
  ranking `L26`, `L28`, `L33`; la columna `H` interpreta fechas como texto.
  No se corrigió por la regla de no modificar planillas.
- Los cargos y pagos de proveedor `FREEZIA / INV-5725` y `PLANET CELLULAR /
  0163445-IN` no tienen una referencia verificable en las fuentes actuales ni
  históricas. Se mantienen sin corrección automática.

## Acción requerida

Para cada excepción, adjuntar o identificar el Invoice, recibo o comprobante
de pago correspondiente. Con ese respaldo se puede corregir en ESWCARGO sin
tocar las planillas y conservando copia reversible del movimiento anterior.
