# Auditoria de cuentas de proveedores - 2026-07-18

Alcance: movimientos de proveedores de los ultimos 730 dias. Ejecucion de solo
lectura sobre la base productiva y contraste sin escritura contra las fuentes
de ventas/compras actual e historica.

## Resultado

- Movimientos auditados: 15.
- Duplicados exactos: 0.
- Diferencias cargo/pago con la misma referencia: 1.
- Cargos que mencionan una compra inexistente en el registro interno: 8.

## Diferencias que requieren respaldo

| Proveedor | Referencia | Cargo | Pago | Diferencia |
| --- | --- | ---: | ---: | ---: |
| PLANET CELLULAR | 0163445-IN | USD 4.590 | USD 45.490 | USD 40.900 |

`INV-5725` de FREEZIA quedó conciliada: el Invoice y la transferencia Mercury
de 23/03/2026 prueban USD 7.300. El cargo productivo `299420` se corrigió de
USD 4.380 a USD 7.300 con respaldo reversible y bitácora de sincronización.

La referencia `0163445-IN` no aparece en `CAB_COMPRAS` de la fuente actual ni
de la histórica consultada. El Invoice de Planet prueba el cargo de USD 4.590,
pero no identifica qué facturas cubre el pago de USD 45.490. Por lo tanto, ese
pago no se modifica sin su comprobante o una relación completa de Invoices.

## Control permanente

`npm run audit:supplier-ledgers` se ejecuta antes y despues de cada
sincronizacion local y cloud. El control alerta sobre duplicados exactos,
diferencias por referencia y cargos sin compra interna, pero no altera saldos.
