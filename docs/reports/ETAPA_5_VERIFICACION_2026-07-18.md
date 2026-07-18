# Verificacion de etapa 5 - 2026-07-18

Contraste contra `CASH FLOW 2026` en solo lectura y la base de produccion. No
se modificaron Google Sheets.

## Resultado final

- Fuente verificada: 1.112 filas, distribuidas en 11 cuentas.
- Filas raw exactas: 1.112.
- Signos, importes, faltantes, referencias repetidas y extras: 0.
- Saldos finales distintos de la fuente: 0.
- Duplicados exactos, documentales y pagos repetidos: 0.
- Los 10 ajustes `CASHFLOW-RECONCILIATION-2026` restantes igualan exactamente
  los movimientos operativos preservados, por lo que cada saldo final coincide
  con Cash Flow.

## Correcciones aplicadas

- Se corrigio el lector de Cash Flow: un aumento de saldo es un `PAGO` y una
  baja es un `CARGO`.
- Se reconstruyeron las 1.112 filas raw en una transaccion con respaldo: 731
  actualizaciones, 98 altas y 13 bajas de filas fuente obsoletas.
- Marcos Roku `#162`: se eliminaron dos pagos manuales agregados y el cargo
  operativo duplicado del pedido `#2525`. Cash Flow conserva las cinco lineas
  fuente que los respaldan y el saldo final se mantiene en USD 7.554.

## Pendientes que no se modificaron

- Baselines historicos sin evidencia documental: 30 cuentas con solo baseline,
  19 mixtas y 2 operativas sin fuente financiera. Jose JR se reconcilió luego
  con seis cabeceras de envío y sus pagos correspondientes.
- Una diferencia histórica de proveedor: `0163445-IN` de PLANET CELLULAR.
  `INV-5725` de FREEZIA quedó conciliada en producción contra Invoice y
  transferencia Mercury de USD 7.300.
- Formulas de `PROXIMOS VENCIMIENTOS` indicadas en el plan de etapa 3. No se
  modifica ninguna planilla desde este sistema.

## Pruebas aprobadas

- Auditoria de deriva Cash Flow y previsualizacion de reconstruccion.
- Auditoria de duplicados de cuenta corriente.
- Pruebas de conciliacion, exportacion con signo contable y pedido de agente.
- Tipos y compilacion de produccion.

## Revalidacion cloud posterior

- Ejecucion completa: [GitHub Actions #29665517776](https://github.com/diegoteacade22/Sistema-Manejo-Eswcargo/actions/runs/29665517776), finalizada correctamente sobre `main` `c63fbb3`.
- Packing: 329 envios operativos auditados en alcance total. El envio #1048
  sigue bloqueado por excepcion documentada, sin contenido verificable.
- Invoice: 529 pedidos con productos verificados correctamente contra la
  fuente recien descargada.
- Cuenta corriente: duplicados exactos, documentales y pagos repetidos: 0.
