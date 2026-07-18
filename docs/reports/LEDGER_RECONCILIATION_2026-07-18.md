# Conciliacion de cuentas corrientes - 2026-07-18

## Correccion aplicada

- Se removio el lote duplicado de 1.133 movimientos creado entre
  `2026-07-18T08:40:52.706Z` y `2026-07-18T08:40:55.848Z`.
- Importe neto del lote removido: USD `-4,448,742.79`.
- Respaldo local: `webapp/backups/ledger-batch-2026-07-18T084052Z.json`.
- Se deshabilito por defecto la recreacion de movimientos financieros y la
  limpieza de importaciones CC en las sincronizaciones operativas.

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

## Regla operativa

Una sincronizacion rutinaria debe conservar:

- `ALLOW_FINANCIAL_LEDGER_SYNC=0`
- `ALLOW_LEGACY_LEDGER_CLEANUP=0`

Para habilitar una escritura financiera futura se requiere un respaldo previo,
un reporte de diferencias y una aprobacion explicita.
