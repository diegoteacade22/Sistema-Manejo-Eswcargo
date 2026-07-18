# Verificacion de etapa 5 - 2026-07-18

Contraste ejecutado en modo solo lectura contra `CASH FLOW 2026` y la base de
produccion. No se modificaron Google Sheets ni movimientos de cuenta corriente.

## Resultado operativo

- Fuente leida: 1.228 filas de Cash Flow, distribuidas en 11 cuentas.
- Saldos finales distintos de la fuente: 0.
- Ajustes globales pendientes: 10 cuentas. Ninguna cumple las condiciones para
  reemplazar el ajuste por filas fuente sin afectar movimientos no demostrados.
- Duplicados exactos de cuenta corriente: 0.
- Duplicados documentales: 0.
- Cargos de pedido o envio en una cuenta de cliente incorrecta: 0.
- Caso que requiere comprobante: Marcos Roku `#162`, pagos `1173202` y
  `1173203`, ambos por USD 14.700 el 2026-07-09.

## Diferencias historicas visibles

El control por contenido detecto 1 fila reubicada, 283 con signo opuesto, 154
cambiadas, 99 faltantes y 14 extras. Son diferencias de detalle historico, no
una autorizacion para reimportar ni borrar movimientos: los 11 saldos finales
coinciden con la fuente.

## Cuentas que siguen bloqueadas

Facu Fabriccini `#66`, Aylen Gentiletti `#70`, Ramiro Star Computacion `#72`,
Nahuel Nuevo `#96`, Tomas Rodriguez `#119`, Sebastian Lunardi `#147`, Marcos
Roku `#162`, Gonzalo Lemesoff `#174`, Luca Sta Fe Nahuel `#214` y Martin
Duster `#275` conservan ajuste global. Todas incluyen movimientos operativos,
cambios historicos o falta de filas raw que requieren comprobante individual.

Nahuel Nuevo y Gonzalo Lemesoff tienen fuente con saldo cero, pero tambien un
movimiento historico de arqueo. No se lo reemplazo ni elimino porque la fuente
no demuestra su origen individual.

## Pruebas aprobadas

- Conciliacion por contenido de Cash Flow.
- Alta, baja y reasignacion diferencial de articulos.
- Rechazo de cabeceras ambiguas y deduplicacion de cabeceras identicas.
- Validacion de tipos de la aplicacion.

## Proximo paso permitido

Registrar Invoice, recibo o comprobante bancario desde `Mantenimiento >
Evidencia de cuentas`, empezando por Marcos Roku. Con esa evidencia se puede
decidir cada movimiento sin alterar el resto de la cuenta.
