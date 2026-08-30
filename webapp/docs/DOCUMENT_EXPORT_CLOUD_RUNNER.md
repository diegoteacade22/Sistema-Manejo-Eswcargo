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
   El readback descarga los bytes reales y valida MIME, tamaño, MD5 de Drive y SHA-256; una `appProperty` por sí sola no alcanza.
5. Recién con el manifiesto piloto verificado, ejecutar manualmente `mode=export`. Antes de consultar la base, el runner resuelve el invoice piloto por identidad, descarga sus bytes y vuelve a validar nombre, carpeta, MIME, fingerprint lógico, tamaño, MD5 y SHA-256 contra la prueba persistida. Sin ese readback el exportador falla cerrado.
6. Revisar el manifiesto remoto y observar al menos dos ventanas de 30 minutos sin pérdida ni duplicados.
7. Recién entonces habilitar `ESW_DOCUMENT_EXPORT_CLOUD_ENABLED=true` y descargar el LaunchAgent. Conservar el plist y el runtime local como rollback.

## Rollback

1. Cambiar `ESW_DOCUMENT_EXPORT_CLOUD_ENABLED=false`.
2. Confirmar que no quede una corrida Cloud activa.
3. Volver a cargar `com.eswcargo.document-export` desde el plist conservado.
4. Verificar un ciclo local y su `events.jsonl` antes de cerrar el incidente.

El estado Cloud vive en `.eswcargo-document-export-state.v1.json` dentro de la misma carpeta Drive y pasa las mismas verificaciones de bytes antes de usarse. También valida versión, fechas ISO canónicas, claves internas, fingerprints SHA-256 y una prueba `pilotCompleted` con identidad, nombre, fingerprint lógico, SHA-256 y tamaño del invoice real. Un manifiesto legado sin piloto puede abrirse para ejecutar `export-one`, pero nunca habilita `full`; el piloto Drive productivo es exclusivamente una orden y una selección fallida no persiste estado.

Cada PDF se localiza por identidad interna inmutable (`order:<id>` o `shipment:<id>:client:<id>`), no sólo por nombre. Un cambio de número renombra el mismo archivo administrado; una colisión con un archivo ajeno falla cerrada. La huella lógica incluye sólo los datos renderizados y una versión explícita de plantilla; los items `CANCELADO` quedan fuera igual que en el renderer. Un cambio de `shipment.weight_cli`, del subtotal persistido de un packing compartido o del diseño actualiza el mismo file ID. Cambios administrativos no impresos, como `updatedAt`, `date_arrived` o el status equivalente de un item activo, no provocan un PDF nuevo. `--force` obliga a reconstruir y verificar, pero no inventa una huella nueva: si el contenido lógico no cambió, Drive responde `UNCHANGED`.

Si un packing compartido deja de incluir a un cliente, el export completo mueve a la papelera de Drive el PDF administrado de ese segmento y confirma `trashed=true` antes de retirar su clave del manifiesto. La operación es idempotente y recuperable desde la papelera; una colisión o falta de confirmación deja la corrida en error y conserva la clave para reintento.
