# Conciliacion de cuentas corrientes - 2026-07-18

## Correccion aplicada

- Se removio el lote duplicado de 1.133 movimientos creado entre
  `2026-07-18T08:40:52.706Z` y `2026-07-18T08:40:55.848Z`.
- Importe neto del lote removido: USD `-4,448,742.79`.
- Respaldo local: `webapp/backups/ledger-batch-2026-07-18T084052Z.json`.
- Se deshabilito por defecto la recreacion de movimientos financieros y la
  limpieza de importaciones CC en las sincronizaciones operativas.
- Se removieron seis movimientos heredados que formaban tres pares exactos de
  cargo equivocado y ajuste compensatorio: `88905/466201`, `88906/466203` y
  `425313/466204`. La fuente operativa confirma que los pedidos `#2398`,
  `#2399` y `#2470` pertenecen a otros clientes y tienen totales distintos.
  El neto removido fue USD `0.00`; respaldo local:
  `webapp/backups/stale-neutralized-order-charges-2026-07-18.json`.

## Saldos conciliados contra fuente

Se registraron ajustes idempotentes `CASHFLOW-RECONCILIATION-2026:<old_id>`
para las 11 cuentas con pestaña en `CASH FLOW 2026` y cinco cuentas con cero
confirmado. La auditoria posterior reviso 70 cuentas y no devolvio bloqueos.

Fuentes de cierre: `MARCOS CC`, `AYLEN CC`, `FACU FABRI CC`, `MOLINA OCT`,
`RAMIRO STRAR CC`, `LUCA CC`, `SEBAS LUC CC`, `MARTIN DUS`, `TOMAS CC`,
`GONZALO CC`, `NAHUEL CC` y los ceros confirmados de Leo X Lucas, Gonzalo Gl,
Federico Esquivel - Canning, Facundo Madeira y Ariel Lencina - Ary-Shop.

## Excepciones sin modificar

- Franco Pepe: pago `tx 417888`, USD `-21,001.80`, referencia no localizada en
  Cash Flow.
- Claudio Molina x IG: pago `tx 454256`, USD `-76,000.00`, referencia no
  localizada en Cash Flow.
- Baselines historicos de otras cuentas permanecen como advertencia. No se
  modifican sin una fuente documental que confirme su origen.
- Posible doble pago de Marcos Roku `#162`: tx `1173202` y `1173203`, ambos
  por USD `14.700` el 2026-07-09. No se elimina sin comprobante porque Cash
  Flow no contiene una fila que permita distinguir uno o dos pagos reales.

## Regla operativa

Una sincronizacion rutinaria debe conservar:

- `ALLOW_FINANCIAL_LEDGER_SYNC=0`
- `ALLOW_LEGACY_LEDGER_CLEANUP=0`

Para habilitar una escritura financiera futura se requiere un respaldo previo,
un reporte de diferencias y una aprobacion explicita.
## Control preventivo incorporado

- La auditoría de duplicados revisa ahora cada `CARGO` que referencia un pedido y lo contrasta con el cliente actual del pedido fuente.
- Si difieren, el proceso lo reporta como una inconsistencia de asignación y Mantenimiento lo muestra como error. No mueve el cargo ni cambia el cliente automáticamente.
- Validación posterior a la corrección: `wrongClientOrderCharges = 0`.
- La auditoría de duplicados recorre ahora el historial completo de cuentas
  corrientes por defecto. Se puede acotar solo mediante
  `LEDGER_DUPLICATE_LOOKBACK_DAYS` para un diagnóstico puntual.

## Cobertura completa de cuentas

La auditoría de solo lectura recorrió las 68 cuentas con movimientos actuales:

- 11 cuentan con fuente directa en `CASH FLOW 2026`.
- 5 tienen saldo cero confirmado.
- 30 contienen únicamente un ajuste histórico de arrastre.
- 19 combinan ajuste histórico y movimientos posteriores.
- 3 contienen movimiento operativo sin pestaña financiera de respaldo.

Los últimos controles completos no encontraron duplicados exactos ni cargos de
pedido asignados a un cliente distinto. Se mantienen abiertos únicamente el
cargo repetido por referencia `#2352` y el posible pago doble de Marcos Roku,
porque la fuente no permite determinar de forma documental cuál movimiento
debería eliminarse.
