# Contraste de movimientos Cash Flow - 2026-07-18

## Fuente y alcance

- Lectura de `CASH FLOW 2026` en Google Sheets, sin modificarla.
- 1.112 variaciones de saldo extraídas de las 11 cuentas con pestaña.
- Producción ESWCARGO: 1.039 movimientos `CASHFLOW-RAW-2026` existentes.

## Hallazgo

El importador histórico aplica `monto = -variación_de_saldo`. La convención de
Cuenta Corriente de ESWCARGO es la inversa: cobros positivos y cargos
negativos. La base ya contiene una mezcla de filas importadas con ambas
convenciones, además de ajustes de conciliación y movimientos de otros
orígenes.

| Situación frente a la fuente actual | Filas |
| --- | ---: |
| Conservan el signo legado invertido | 569 |
| Coinciden con el signo correcto | 283 |
| Difieren por monto u otra modificación | 156 |
| Existen en Cash Flow y faltan en producción | 104 |

También hay 31 referencias raw adicionales, principalmente anulaciones y
ajustes por fila previos.

## Decisión aplicada

No se invirtió ni reimportó el lote completo: hacerlo alteraría saldos ya
compensados por ajustes de conciliación y podría duplicar operaciones contra
movimientos de otros orígenes. Las sincronizaciones operativas continúan con
la escritura financiera deshabilitada y ejecutan auditorías de cuenta corriente
y duplicados antes y después de cada actualización.

## Próximo procedimiento seguro

1. Crear un respaldo completo de movimientos y ajustes por las 11 cuentas.
2. Construir una tabla de correspondencia fila fuente - movimiento sistema.
3. Corregir por cuenta, recalculando el ajuste de conciliación para conservar
   el saldo final confirmado por Cash Flow.
4. Validar cada cuenta contra el saldo de la pestaña antes de pasar a la
   siguiente. No se modifican planillas.
