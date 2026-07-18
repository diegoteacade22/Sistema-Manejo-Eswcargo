# Auditoria de cuentas de proveedores - 2026-07-18

Alcance: movimientos de proveedores de los ultimos 730 dias. Ejecucion de solo
lectura sobre la base productiva y contraste sin escritura contra las fuentes
de ventas/compras actual e historica.

## Resultado

- Movimientos auditados: 15.
- Duplicados exactos: 0.
- Diferencias cargo/pago con la misma referencia: 2.
- Cargos que mencionan una compra inexistente en el registro interno: 8.

## Diferencias que requieren respaldo

| Proveedor | Referencia | Cargo | Pago | Diferencia |
| --- | --- | ---: | ---: | ---: |
| FREEZIA TRADING LLC | INV-5725 | USD 4.380 | USD 7.300 | USD 2.920 |
| PLANET CELLULAR | 0163445-IN | USD 4.590 | USD 45.490 | USD 40.900 |

No se modifico ningun movimiento. Las referencias `INV-5725` y `0163445-IN`
no aparecen en `CAB_COMPRAS` de la fuente actual ni de la historica consultada.
Por lo tanto, el importe correcto no puede inferirse de forma segura.

## Control permanente

`npm run audit:supplier-ledgers` se ejecuta antes y despues de cada
sincronizacion local y cloud. El control alerta sobre duplicados exactos,
diferencias por referencia y cargos sin compra interna, pero no altera saldos.
