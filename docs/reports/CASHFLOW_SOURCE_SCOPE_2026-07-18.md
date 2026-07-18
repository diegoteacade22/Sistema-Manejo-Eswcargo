# Alcance de fuentes para cuentas corrientes - 2026-07-18

Esta auditoria se ejecutó en modo lectura. No se modificó ninguna Google Sheet
ni movimiento financiero de ESWCARGO.

## Fuentes y uso permitido

| Fuente | Identificador | Uso aprobado | Limitación |
| --- | --- | --- | --- |
| `CASH FLOW 2026` | `1PFHlsVhP16Ge-qXF7qn16G2FPBnMVpF7TMkIjDorxc8` | Fuente financiera vigente para 11 cuentas corrientes y sus saldos de cierre. | Sus filas históricas pueden haber sido reordenadas o ajustadas; no se reconstruye una cuenta por diferencias de saldo entre filas. |
| `VENTAS - COMPRAS 2025-2026` | `1GhLokb_V5Yok2ubxBg8Tr0jxE3nFkwCD2sMvWDHZ20o` | Fuente operativa vigente de pedidos, envíos, productos e Invoices. | No reemplaza por si sola un movimiento de cuenta corriente anterior. |
| `VENTAS COMPRAS 2023 al 2025` | `12ba_3FX1xK6d8UmzkeRBXhCVYXfi8plL-Uga5tXpajE` | Búsqueda histórica de Invoices y clientes. | Es histórica; solo aporta evidencia complementaria. |
| `VENTAS COMPRAS 2023 al 2025 Para Sistema en Gemini_backup.xlsx` | `1cznosRyQ8BTi8pfzZirO7UwJbeUzTNOc` | Respaldo histórico de movimientos de cuenta para casos puntuales. | Solo se usa cuando identifica expresamente el movimiento y el cliente; no se importa ni reescribe el historial. |
| `CASH FLOW 2025` | `1MpxlrPQzA_4Tu3uKqetLvV9mfRMwPJyYp2nWHIMo-EQ` | Consulta documental de antecedentes. | Contiene bloques de cuentas y notas operativas; no es apta para importación automática. |
| `Cuentas Corrientes 2021` | `1L473hMg6W_nNt9JEEA4gMqfC2itE7DaZIHR10wKngSk` | Consulta documental de antecedentes. | Archivo histórico, sin autoridad para cambiar saldos vigentes. |
| `Cuentas Corrientes 2022` | `1Dwq1FXu-44MtDGbUxA9icfz6AZS-VtelLfGjoydiNN4` | Consulta documental de antecedentes. | Archivo histórico, sin autoridad para cambiar saldos vigentes. |

## Estado de cobertura

La auditoría de cuentas corrientes vigente reporta 68 cuentas:

| Estado | Cantidad | Tratamiento |
| --- | ---: | --- |
| Con fuente Cash Flow vigente | 11 | Saldo conciliado con `CASH FLOW 2026`. |
| Saldo cero confirmado | 5 | Sin acción pendiente. |
| Solo ajuste histórico | 30 | Mantener; requiere comprobante externo antes de tocar el ajuste base. |
| Ajuste histórico mixto | 19 | Mantener; requiere comprobante externo antes de separar o reemplazar movimientos. |
| Operativa sin fuente Cash Flow | 2 | Revisar con documentación comercial antes de declarar saldo conciliado. |
| Conciliada por cabeceras de envío | 1 | Jose JR `#291`: seis envíos y dos pagos cierran en cero. |

No se debe usar una fuente histórica para transformar automáticamente ninguna
de las 51 cuentas que no tienen una fuente financiera vigente directa.

## Resultado de Invoices contra fuentes activas

Se revisaron 274 referencias de Invoice de `CASH FLOW 2026`:

| Resultado | Cantidad | Acción |
| --- | ---: | --- |
| Coincidencia de cliente e importe | 239 | Sin acción. |
| Diferencia de importe | 27 | Cola de revisión; no corregir por diferencia de saldo entre filas. |
| Diferencia menor de redondeo | 2 | Mantener hasta revisión comercial. |
| Cliente distinto entre fuentes | 5 | Bloqueado: requiere Invoice o comprobante. |
| Invoice no localizado en ventas | 1 | Bloqueado: requiere Invoice o comprobante. |
| Referencia repetida de cargo | 1 | Referencia compartida documentada; conservar ambos movimientos y mantenerla visible. |

Las 136 diferencias de variación de saldo son una señal de auditoría, no una
instrucción de escritura: el saldo acumulado de la planilla puede incorporar
filas reordenadas, devoluciones y ajustes manuales.

## Casos que requieren control con referencia concreta

| Cuenta / Invoice | Fuente financiera | Fuente comercial | Decisión |
| --- | --- | --- | --- |
| Luca Sta Fe Nahuel, `#2352` | Dos cargos: USD 9.000 el 12/02/2026 y USD 1.265 el 25/02/2026. | La copia histórica `LUCA CC` registra ambos importes. | Conservar ambos; la referencia compartida queda documentada, no se elimina como duplicado. |
| Aylen Gentiletti, `#2284` | USD 1.135, 09/01/2026. | Ventas vigentes lo asignan a Luca por USD 1.115. | No reasignar cliente ni importe sin Invoice. |
| Facu Fabri, `#2175` | USD 1.500, 29/10/2025. | Ventas vigentes lo asignan a Marcos por USD 0. | No reasignar sin comprobante. |
| Facu Fabri, `#2484` | USD 14.475, 19/05/2026. | Ventas vigentes lo asignan a Federico Canning por USD 7.685. | No reasignar ni modificar monto sin comprobante. |
| Luca Sta Fe Nahuel, `#2232` | USD 10.460, 04/12/2025. | Ventas vigentes lo asignan a Lucas Cly por USD 0. | No reasignar sin comprobante. |
| Aylen Gentiletti, `#2641` | USD 45.200. | No aparece en ventas actual ni histórica. | Mantener cargo; identificar Invoice o comprobante. |
| Marcos Roku, pagos y `#2525` | Dos pagos manuales y un cargo de pedido. | Cash Flow identifica dos cobros de USD 15.000 menos comisiones y la Invoice `#2525`. | Resuelto: se conservaron las líneas fuente y se retiraron los duplicados. |

La quinta diferencia de cliente detectada es un cruce histórico de Invoice
`#2131` entre Marcos y Barbieri Family. Tampoco se modifica porque la venta
vigente figura con total cero y no aporta una fuente concluyente.

## Regla operativa de corrección

Un cambio financiero en ESWCARGO solo podrá aplicarse cuando exista al menos
una de estas pruebas vinculada al caso: Invoice emitido, recibo de cobro,
comprobante bancario, nota de crédito o confirmación comercial verificable.

La corrección deberá conservar el movimiento anterior en respaldo, registrar
la evidencia, y volver a ejecutar las auditorías de duplicados, cobertura de
cuentas y referencias de Invoice. Sin esa evidencia, el sistema alerta y
preserva el estado actual.
