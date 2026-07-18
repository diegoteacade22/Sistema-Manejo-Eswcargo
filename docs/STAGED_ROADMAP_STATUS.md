# Estado y pendientes por etapa

Este documento se actualiza al finalizar cada etapa. Un pendiente no habilita
ninguna escritura automatica sobre planillas ni base de datos.

## Etapa 1: Blindaje operativo

### Implementado

- Reinicio de base bloqueado desde mantenimiento.
- Packing e invoice bloqueados cuando no hay contenido verificable.
- Auditorias de packing, asignaciones e invoice dentro de la sincronizacion.
- Descarga fallida de la fuente cancela la sincronizacion.
- Limpieza destructiva de registros bloqueada salvo habilitacion explicita.
- Historial persistente de cada sincronizacion con estado, alcance, duracion y
  contadores operativos. La ejecucion crea el registro antes de procesar y lo
  cierra como fallida si ocurre un error.
- Bitacora por registro, con antes/despues y motivo para altas, cambios de
  cabecera, items, reasignaciones y rechazos. Se visualiza en Mantenimiento.
- Las cabeceras duplicadas e incompatibles se rechazan sin sobrescribir el
  registro productivo. Los proveedores se identifican por codigo, no por
  nombre repetido.
- Prueba autenticada de producción: aislamiento de cliente, costos sensibles,
  detalle de envío, Packing e Invoice propios/ajenos, asignación de compra,
  movimiento propio y acceso administrativo. Los datos QA se crean aislados y
  se eliminan al final de cada corrida.

### Pendiente

- Revisar el unico packing operativo sin contenido confirmado, `#1048`, cuando
  exista fuente documental; no se deben inventar articulos.
- Completar la cabecera del envio `#1172` para el pedido `#2479`; el contraste
  lo deja como advertencia y no inventa una cabecera faltante.
- Resolver en la fuente las 13 cabeceras de envio duplicadas y la cabecera
  duplicada del pedido `#2223`, documentadas en el reporte de colisiones. No
  se debe elegir una fila automaticamente.

## Etapa 2: Bandeja de pedidos

### Implementado

- Bandeja para pegar texto de WhatsApp y generar un borrador editable.
- Dictado desde el navegador que completa el mismo borrador.
- Confirmacion explicita antes de crear el pedido mediante el circuito canonico.
- Condición de pago estructurada en el pedido, sin crear pagos automáticos.
- Confirmación obligatoria de despacho y validación de servidor para cada
  número de envío asignado.

### Pendiente

- Conexion directa con WhatsApp Business: requiere credenciales y aprobacion de
  la cuenta de Meta.
- Transcripcion de archivos de audio: requiere definir proveedor y credenciales.

## Etapa 3: Planillas y Cash Flow

### Implementado

- Ventas/Compras es la unica fuente automatica de pedidos, articulos y envios.
- Cash Flow queda separado como fuente de consulta y reconciliacion; no escribe
  en la operacion.
- Auditoria de solo lectura sobre caja, 70 cuentas corrientes y
  vencimientos, con reporte descargable.
- La sincronizacion desde mantenimiento y la diaria cloud usan fuente completa;
  un cambio historico ya no depende de los ultimos 7 o 30 dias.
- La extraccion reconoce las cabeceras `NUMERO` y `NRO ENVIO`; una fuente
  completa sin envios ahora detiene el proceso en vez de ocultar el problema.
- El envio `#1048` queda como excepcion documentada: sigue bloqueado para
  imprimir o enviar y visible en Mantenimiento, pero no detiene una
  sincronizacion correcta por otros datos.

### Pendiente

- Corregir con revision manual estas formulas de `PROXIMOS VENCIMIENTOS`:
  - `Z2` y `Z3`: convierten el encabezado `B2` como si fuera una fecha.
  - Columna `H`: las fechas son valores de fecha reales y la formula las trata
    como texto; los dias restantes quedan vacios.
  - `L26`, `L28` y `L33`: el ranking usa valores vacios de `H` y devuelve
    `#NUM!`.
- Definir formato normalizado, responsable y reglas de importacion para cada
  pestana de Cash Flow antes de habilitar cualquier escritura.
- Ejecutar una reconciliacion de cuenta corriente vigente y revisar sus alertas
  antes de modificar signos, duplicados o ajustes historicos. La auditoria
  actual detecta pagos con signo negativo para Franco Pepe `#84` y Claudio
  Molina x IG `#261`, ademas de saldos y baselines que requieren clasificacion
  contable manual.
- Mantener la medicion de rendimiento. Las tres ultimas sincronizaciones
  completas verificadas finalizaron en 82, 68 y 83 segundos, sin volver a
  filtrar por fecha.
- El historial raw de Cash Flow tiene referencias históricas que no reflejan
  exactamente cada fila de origen. No se corrigió en bloque: el control de
  deriva confirma que los 11 saldos finales coinciden, mientras documenta 283
  signos opuestos, 156 importes o tipos distintos, 104 faltantes y 13 filas
  extra. Cualquier corrección futura requiere respaldo y revisión por cuenta.
- Contraste de referencias Invoice entre Cash Flow y Ventas/Compras, también
  solo lectura. Detecta un único cargo repetido por referencia (`#2352`, Luca)
  y mantiene visibles los importes, clientes e Invoices que no se pueden
  verificar desde la fuente sin alterar la cuenta conciliada.

## Etapa 4: Panel operativo

### Implementado

- Banda "Operación de hoy" en el Dashboard administrativo: pedidos por
  confirmar, envíos sin arribo confirmado y excepciones activas, con acceso
  directo a cada área de trabajo.
- Cola concreta de operación: hasta cinco pedidos en `COMPRAR` o `RESERVADO`
  y cinco envíos en movimiento, con cliente, estado y acceso al registro.
- Lista de Packing bloqueados: detecta envíos operativos con cantidades
  declaradas pero sin artículos vinculados ni descripción imprimible. Solo
  informa y lleva al documento; no completa ni modifica datos.
- Vista financiera con marca de fuente, cálculo y última sincronización
  validada; elimina la leyenda genérica "actualizado hoy".
- Mantenimiento muestra hasta 50 cambios recientes para no ocultar las
  excepciones de una corrida completa.

### Pendiente

- Extender la vista de hoy con cobros esperados en una lista accionable. Las
  cuentas por cobrar actuales ya se muestran como Top 5, pero falta separarlas
  por vencimiento confirmado desde una fuente financiera normalizada.
- Integrar vencimientos y cobranzas esperadas cuando exista una fuente
  financiera normalizada que confirme fecha de vencimiento y compromiso.
- Alertas accionables conectadas a los controles de las etapas 1 y 3.

## Etapa 5: Rendimiento y supervisión de sincronización

### Implementado

- La sincronización completa compara los ítems de cada pedido y solo los
  reemplaza cuando hay una diferencia real en producto, cantidad, precio,
  envío o estado.
- Los contadores de artículos de envío se actualizan solamente si cambiaron.
- Tres corridas completas verificadas finalizaron en 82, 68 y 83 segundos,
  debajo del umbral de 120. En cada una coincidieron 1.217 lineas de envio,
  328 Packing operativos y 529 Invoices con productos verificados.
- Las tres corridas no crearon movimientos financieros. La segunda y tercera
  tampoco reescribieron articulos de pedidos sin cambios.
- Simulación determinística fuera de producción que cubre alta, baja y
  reasignación de productos; valida que los pedidos sin cambios no se
  reescriben.
- Medición por descarga, extracción, actualización y auditorías; el resumen
  alerta cuando el total supera 120 segundos (configurable con
  `SYNC_ALERT_THRESHOLD_SECONDS`). El centro de Mantenimiento muestra la
  duración de cada corrida cloud y la marca como excepción si supera el umbral.
- Control de deriva Cash Flow en modo solo lectura, ejecutado antes y después
  de cada actualización local o cloud. Contrasta cada referencia de las 11
  cuentas, detecta faltantes, signos opuestos, cambios, referencias repetidas
  y extras, y verifica que el saldo final de cada cuenta siga coincidiendo con
  la fuente. No crea ni altera movimientos financieros.

### Pendiente

- Revisar trimestralmente el umbral de 120 segundos solo si el crecimiento de
  la fuente vuelve insuficiente el margen actual.
- Resolver solamente con respaldo y evidencia documental las diferencias raw
  históricas de Cash Flow. Mientras tanto, el control las deja visibles sin
  reimportar ni modificar cuentas que hoy concilian.
