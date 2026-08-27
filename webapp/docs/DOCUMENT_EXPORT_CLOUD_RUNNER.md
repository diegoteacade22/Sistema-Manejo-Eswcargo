# Exportador documental Cloud

Estado al 2026-08-27: `PREPARED / NOT_ACTIVE`.

El workflow `Exportación documental ESWCARGO Cloud` conserva una sola ejecución concurrente y queda cerrado para la agenda hasta que `ESW_DOCUMENT_EXPORT_CLOUD_ENABLED=true`. El LaunchAgent local no se modifica durante la preparación.

## Configuración requerida

- Secretos existentes: `DATABASE_URL`, `DIRECT_URL`, `GOOGLE_CREDENTIALS`.
- Secreto pendiente: `ESW_DOCUMENT_EXPORT_DRIVE_FOLDER_ID`.
- `GOOGLE_CREDENTIALS` debe ser JSON `service_account`; el workflow valida tipo, email y clave sin mostrar valores.
- La carpeta debe estar compartida con la identidad del service account.

## Prueba y cutover

1. Ejecutar manualmente `mode=probe`. Debe confirmar acceso a la carpeta y readback saneado de un artefacto existente, sin escribir.
2. Ejecutar `mode=dry-run`. Debe consultar datos y Drive sin guardar documentos ni estado.
3. Ejecutar `mode=export-one` con un `order_id` interno aprobado. Debe devolver `CREATED` o `UPDATED`, readback de ID corto, tamaño y prefijo SHA-256, y crear el manifiesto piloto.
4. Repetir el mismo `export-one`. Debe devolver `UNCHANGED` aunque el generador PDF cambie metadatos volátiles como `CreationDate` o `ModDate`.
5. Recién con el manifiesto piloto verificado, ejecutar manualmente `mode=export`. Sin ese estado previo el exportador falla cerrado, sin exportar ni persistir fingerprints.
6. Revisar el manifiesto remoto y observar al menos dos ventanas de 30 minutos sin pérdida ni duplicados.
7. Recién entonces habilitar `ESW_DOCUMENT_EXPORT_CLOUD_ENABLED=true` y descargar el LaunchAgent. Conservar el plist y el runtime local como rollback.

## Rollback

1. Cambiar `ESW_DOCUMENT_EXPORT_CLOUD_ENABLED=false`.
2. Confirmar que no quede una corrida Cloud activa.
3. Volver a cargar `com.eswcargo.document-export` desde el plist conservado.
4. Verificar un ciclo local y su `events.jsonl` antes de cerrar el incidente.

El estado Cloud vive en `.eswcargo-document-export-state.v1.json` dentro de la misma carpeta Drive. Cada PDF se localiza por identidad interna inmutable (`order:<id>` o `shipment:<id>:client:<id>`), no sólo por nombre. Un cambio de número renombra el mismo archivo administrado; una colisión con un archivo ajeno falla cerrada. La idempotencia usa una huella lógica estable y conserva por separado el SHA-256 real del payload para el readback de carpeta, tamaño, identidad y contenido.
