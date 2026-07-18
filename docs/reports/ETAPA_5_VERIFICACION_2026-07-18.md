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

## Revalidacion de cabeceras compartidas

- Ejecucion completa: [GitHub Actions #29665949281](https://github.com/diegoteacade22/Sistema-Manejo-Eswcargo/actions/runs/29665949281), finalizada correctamente sobre `main` `f40c2c1`.
- Las cabeceras con varias asignaciones de cliente se consolidan solo cuando
  coinciden forwarder, fechas, tipo, estado y observacion. Pesos, costos,
  cobros y rentabilidad se totalizan; los cargos de flete conservan una
  referencia por cliente para una futura conciliacion financiera autorizada.
- Envio `#1188`: 16 piezas verificadas por detalle, 10 de Ramiro Star y 6 de
  Marcos Roku. Envio `#1204`: 13 piezas verificadas, 11 de Ramiro Star y 2
  de Franco Visciarelli. Los Packing se resuelven por articulos y no por una
  cabecera compartida.
- Resultado de fuente: 793 cabeceras sincronizadas, 9 cabeceras compartidas
  consolidadas y 5 conflictos reales conservados como bloqueados.
- Packing: 329 envios operativos auditados. Invoice: 529 pedidos con
  productos auditados. Las 1.219 asignaciones de envio coinciden con la
  planilla; no se activó la reconstruccion financiera.

## Pendientes de fuente

- Pedido `#2223`: dos cabeceras incompatibles, clientes `#70` y `#151`.
- Envios `#383`, `#659`, `#662` y `#972`: cada uno conserva dos filas con una
  diferencia operacional real (forwarder, fechas, tipo, estado o campos de
  carga). Se mantienen sin consolidar ni modificar.
- Envio `#1048`: sin cabecera ni detalle verificable; permanece bloqueado
  para emision de Packing List.
