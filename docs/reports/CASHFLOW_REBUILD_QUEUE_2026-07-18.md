# Cola de reconstrucción de cuentas Cash Flow

Fecha de contraste: 2026-07-18. Fuente consultada en solo lectura: `CASH FLOW
2026`. No se modificó ninguna planilla.

## Reconstrucción completada

- Octavio Molina (`#273`): seis filas fuente incorporadas y ajuste global de
  USD -280 eliminado. El saldo final quedó en USD -280, igual a la fuente.

## Pendiente de detalle por movimiento

Estas cuentas conservan un ajuste global porque su detalle combina filas raw,
movimientos operativos y cambios históricos de la fuente. El ajuste coincide
matemáticamente con la diferencia, pero no es evidencia suficiente para
considerar el detalle conciliado.

| Cliente | ID | Ajuste global (USD) | Motivo de bloqueo |
| --- | ---: | ---: | --- |
| Facu Fabriccini | 66 | -25,645 | 84 signos opuestos, 35 importes cambiados y movimientos operativos. |
| Aylen Gentiletti | 70 | -80,395 | 35 signos opuestos, 30 importes cambiados y movimientos operativos. |
| Ramiro Star Computacion | 72 | -75,134 | 11 importes cambiados, 13 filas faltantes y movimientos operativos. |
| Nahuel Nuevo | 96 | -17,839 | Sin raw importado; existen movimientos operativos contra fuente con saldo cero. |
| Tomas Rodriguez | 119 | -24,610 | Signos, importes y movimientos operativos sin vinculación individual. |
| Sebastian Lunardi | 147 | -43,775 | Signos, importes y movimientos operativos sin vinculación individual. |
| Marcos Roku | 162 | -34,002 | 137 signos opuestos, 58 importes cambiados y pagos manuales a contrastar. |
| Gonzalo Lemesoff | 174 | -11,641 | Sin raw importado; existen movimientos operativos contra fuente con saldo cero. |
| Luca Sta Fe Nahuel | 214 | -15,735 | Signos, importes y referencias Invoice históricas compartidas. |
| Martin Duster | 275 | -96,835 | Signos, importes y movimientos operativos sin vinculación individual. |

## Regla de aplicación

No se elimina un ajuste ni se borra un pago o cargo operativo hasta que una
simulación pruebe, para esa cuenta, que cada fila fuente queda representada una
sola vez y que el saldo final coincide. Los comprobantes externos se registran
desde `Mantenimiento > Evidencia de cuentas`.
