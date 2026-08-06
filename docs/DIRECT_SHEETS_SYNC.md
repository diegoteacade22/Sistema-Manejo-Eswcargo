# Sincronizacion directa Google Sheets -> Supabase

## Motivo

El boton de mantenimiento usaba GitHub Actions como si fuera una API interactiva. En la corrida
`31114741120`, el trabajo de descarga, extraccion y base de datos tomo cerca de 31 segundos, pero la
preparacion del runner demoro aproximadamente 3 minutos y 27 segundos. La corrida `31118480381`
permanecio en cola sin ejecutar pasos. Esa espera pertenece a GitHub y la aplicacion no puede
controlarla.

El modo de 7 dias tampoco era realmente pequeño: exportaba el workbook completo, parseaba hojas
completas y recien despues filtraba fechas.

## Nuevo contrato

- El boton operativo ejecuta `runDirectSheetSync()` dentro del backend autenticado de la aplicacion.
- Google Sheets se lee con una sola solicitud `values.batchGet` y rangos acotados.
- Los pedidos y sus items se limitan realmente a la ventana solicitada (7 dias en el boton);
  los estados de envios se comparan por delta porque la hoja no expone fecha de ultima modificacion.
- La fuente se compara por claves de negocio estables (`shipment_number`, `order_number` y los items
  normalizados).
- Supabase recibe solamente registros nuevos o modificados.
- Cada intento crea un `SyncRun` y los cambios confirmados se guardan en `SyncChange`.
- Un advisory lock transaccional impide dos escrituras directas simultaneas.
- Los movimientos financieros, compras y limpiezas historicas quedan fuera de esta ruta.
- Pesos, cantidad de articulos, costos, cobros y ganancias de envios se conservan para FULL porque
  las cabeceras compartidas usan una agregacion historica distinta.
- La reconciliacion FULL continua en GitHub Actions como respaldo controlado.
- El cron diferencial de 30 minutos se elimina para que GitHub no compita con la ruta directa; se
  conserva un FULL diario a las 08:05 UTC.

## Seguridad y operacion

- La cuenta de servicio se obtiene unicamente de variables de entorno del servidor.
- Ninguna credencial se envia al navegador ni se escribe en logs.
- Los estados en blanco no reemplazan estados existentes.
- Una lectura incompleta detiene la operacion antes de borrar o reemplazar items.
- La interfaz informa exito solo despues de finalizar las escrituras y actualizar `SyncRun`.
- `DIRECT_SHEETS_SYNC_ENABLED=true` habilita la ruta directa. El valor por defecto es `false` para
  que un deploy no cambie el flujo antes de terminar la validacion controlada.

## Validacion antes de promover

1. Ejecutar pruebas de parser/delta y las pruebas actuales de estados de envios.
2. Compilar Next.js con Prisma generado.
3. Ejecutar `runDirectSheetSync({ dryRun: true })` contra produccion y revisar el plan; este modo
   calcula el delta sin ejecutar escrituras ni crear registros de auditoria.
4. Ejecutar una sincronizacion directa sin cambios y comprobar `changed = 0`.
5. Modificar un registro controlado en Sheets, ejecutar el boton y verificar la fila exacta en
   Supabase y `SyncChange`.
6. Repetir la misma ejecucion y comprobar idempotencia (`changed = 0`).
7. Confirmar desde la aplicacion que el cambio ya se proyecta sin recargar un deploy.

## Rollback

Configurar `DIRECT_SHEETS_SYNC_ENABLED=false` en Vercel. El boton vuelve al flujo cloud existente sin
cambiar el esquema ni eliminar datos.
