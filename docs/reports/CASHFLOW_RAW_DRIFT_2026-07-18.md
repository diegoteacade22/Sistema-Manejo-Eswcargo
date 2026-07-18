# Contraste de movimientos Cash Flow - 2026-07-18

## Fuente y alcance

- Lectura de `CASH FLOW 2026` en Google Sheets, sin modificarla.
- 1.112 variaciones de saldo extraídas de las 11 cuentas con pestaña.
- Producción ESWCARGO: 1.021 movimientos `CASHFLOW-RAW-2026` vinculados a las 11 cuentas auditadas.

## Hallazgo

La fuente puede convertirse a la convención actual de Cuenta Corriente con
`monto = -variación_de_saldo`: una suba de saldo es un cargo negativo y una
baja es un cobro positivo. El problema histórico no permite asumir que cada
fila actual siga esa regla: hay filas con signo opuesto, faltantes, diferencias
de importe y ajustes de conciliación que conservan el saldo final correcto.

| Situación frente a la fuente actual | Filas |
| --- | ---: |
| Coinciden con la conversión actual de la planilla | 569 |
| Tienen el signo opuesto a la conversión esperada | 283 |
| Difieren por monto u otra modificación | 156 |
| Existen en Cash Flow y faltan en producción | 104 |

También hay 13 referencias raw adicionales dentro de estas cuentas, principalmente
anulaciones y ajustes por fila previos. El auditor identifica además cualquier
repetición de una misma referencia de origen.

## Decisión aplicada

No se invirtió ni reimportó el lote completo: hacerlo alteraría saldos ya
compensados por ajustes de conciliación y podría duplicar operaciones contra
movimientos de otros orígenes. Las sincronizaciones operativas continúan con
la escritura financiera deshabilitada y ejecutan auditorías de cuenta corriente,
duplicados y deriva de Cash Flow antes y después de cada actualización.

## Próximo procedimiento seguro

1. Crear un respaldo completo de movimientos y ajustes por las 11 cuentas.
2. Construir una tabla de correspondencia fila fuente - movimiento sistema.
3. Corregir por cuenta, recalculando el ajuste de conciliación para conservar
   el saldo final confirmado por Cash Flow.
4. Validar cada cuenta contra el saldo de la pestaña antes de pasar a la
   siguiente. No se modifican planillas.
