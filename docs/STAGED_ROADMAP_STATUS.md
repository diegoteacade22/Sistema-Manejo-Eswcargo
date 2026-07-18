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
- Los Packing List de un envío compartido se emiten por cliente: el operador
  debe seleccionar un segmento y el documento incluye exclusivamente sus
  artículos. Se bloquea si algún artículo no tiene cliente verificable, si hay
  un rechazo de pedido o si el rechazo de envío es distinto a una cabecera
  compartida incompatible. El peso y cargo común no se atribuyen a ningún
  cliente hasta que exista una cabecera fuente unívoca.
- Envío `#1172` reconciliado en la base a partir de las cuatro líneas
  verificadas del pedido `#2479`: 6 artículos, USD 7.230 de venta y USD 7.170
  de costo. La cabecera deja explícitos los datos que la fuente no aporta
  (forwarder, pesos y arribo) en vez de inventarlos.
- Prueba autenticada de producción: aislamiento de cliente, costos sensibles,
  detalle de envío, Packing e Invoice propios/ajenos, asignación de compra,
  movimiento propio y acceso administrativo. Los datos QA se crean aislados y
  se eliminan al final de cada corrida.

### Pendiente

- Revisar el unico packing operativo sin contenido confirmado, `#1048`, cuando
  exista fuente documental; no se deben inventar articulos. El Packing, PDF y
  email quedan bloqueados en servidor hasta entonces.
- Resolver en la fuente las 13 cabeceras de envio duplicadas y la cabecera
  duplicada del pedido `#2223`, documentadas en el reporte de colisiones. No
  se debe elegir una fila automaticamente. La única excepción documental es
  el Packing segmentado por cliente cuando la causa exacta es cabecera
  compartida incompatible; los documentos de un pedido rechazado y cualquier
  otro rechazo de envío permanecen bloqueados.

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
- El Dashboard administrativo muestra todas las excepciones calculadas y
  enlaza directamente al centro de Mantenimiento; ya no deja alertas ocultas
  detrás de un único resumen.

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
- La auditoría de Packing que ejecuta cada sincronización valida también que
  cada artículo efectivo tenga un cliente verificable. Si encuentra un artículo
  sin dueño, la actualización falla antes de habilitar documentos incompletos.
- Medición por descarga, extracción, actualización y auditorías; el resumen
  alerta cuando el total supera 120 segundos (configurable con
  `SYNC_ALERT_THRESHOLD_SECONDS`). El centro de Mantenimiento muestra la
  duración de cada corrida cloud y la marca como excepción si supera el umbral.
- Control de deriva Cash Flow en modo solo lectura, ejecutado antes y después
  de cada actualización local o cloud. Contrasta cada referencia de las 11
  cuentas, detecta faltantes, signos opuestos, cambios, referencias repetidas
  y extras, y verifica que el saldo final de cada cuenta siga coincidiendo con
  la fuente. No crea ni altera movimientos financieros.
- Contraste de referencias Invoice en modo solo lectura contra ventas actuales
  e históricas antes de cada sincronización. Las diferencias quedan visibles y
  no alteran cuentas conciliadas.
- Los cargos manuales de envío son idempotentes por envío y cliente: un reintento
  actualiza el cargo existente en vez de crear otro. Los pagos de compras se
  rechazan si repiten compra, fecha, monto, método y referencia.
- Un cargo de envío sólo puede asignarse al único cliente presente en sus
  artículos confirmados. Los envíos compartidos quedan bloqueados para cargos
  comunes hasta registrar una distribución documental; la auditoría recurrente
  detecta tanto cargos `SHIP-*` ambiguos como asignados al cliente incorrecto.
- Los pagos de clientes ahora se rechazan si repiten cliente, fecha, monto y
  referencia, incluso si el segundo intento cambia u omite el método de pago.
  La detección corre antes y después de cada actualización y se muestra en
  Mantenimiento.
- Cada cargo de cuenta corriente que referencia un pedido se contrasta con el
  cliente del pedido fuente. Una diferencia se muestra como error en
  Mantenimiento y en las auditorías pre/post sincronización; no modifica la
  cuenta automáticamente.
- El flujo cloud declara de forma explícita la ubicación de las credenciales
  de Google para las auditorías de Cash Flow, evitando que una ejecución use
  una ruta temporal distinta.
- Los pagos manuales quedan protegidos por una clave transaccional en base de
  datos. Dos solicitudes simultáneas con cliente, fecha, monto y referencia
  iguales no pueden crear dos cobros.
- Los cargos manuales de envío también tienen una restricción de base de datos
  para `SHIP-*`; dos solicitudes simultáneas no pueden crear el mismo cargo.
- Los pagos a proveedor quedan protegidos por una clave transaccional de
  compra, fecha, monto y referencia. El intento duplicado revierte también su
  movimiento de proveedor, antes de que pueda afectar el saldo.
- Pruebas transaccionales verifican los tres controles de duplicación
  financiera y se revierten sin dejar datos de prueba.
- La asignación de compras reserva cantidad de forma atómica. La reserva no
  puede superar la cantidad comprada aunque dos operadores confirmen al mismo
  tiempo; un control pre/post sincronización contrasta el contador contra las
  asignaciones reales y detiene la corrida ante cualquier deriva.
- El alta de pedidos desde la pantalla, bandeja de WhatsApp y API de agente
  exige una clave de idempotencia. Un reintento devuelve el pedido original en
  lugar de crear otro pedido, cargo o documento.
- Se eliminaron tres pares históricos de cargo equivocado y ajuste
  compensatorio (`#2398`, `#2399`, `#2470`) después de validar que cada par
  mantenía el saldo neto en cero y que la fuente operativa atribuye los pedidos
  a otros clientes. El procedimiento generó respaldo reversible.
- Auditoría de proveedores antes y después de cada sincronización local o cloud.
  Detecta duplicados exactos, pagos que no cierran contra su cargo y referencias
  de compras sin registro interno. Solo alerta: nunca modifica saldos ni la
  planilla.
- La entrega automática omite envíos compartidos. Requieren emisión manual
  por cliente hasta implementar notificaciones independientes y auditables
  para cada segmento.

### Pendiente

- Revisar trimestralmente el umbral de 120 segundos solo si el crecimiento de
  la fuente vuelve insuficiente el margen actual.
- Resolver solamente con respaldo y evidencia documental las diferencias raw
  históricas de Cash Flow. Mientras tanto, el control las deja visibles sin
  reimportar ni modificar cuentas que hoy concilian.
- Revisar dos diferencias históricas de proveedores sin corregirlas de forma
  automática: `INV-5725` de FREEZIA (cargo USD 4.380, pago USD 7.300) y
  `0163445-IN` de PLANET CELLULAR (cargo USD 4.590, pago USD 45.490). Las
  referencias no aparecen en las fuentes de ventas/compras actuales ni
  históricas consultadas. Ocho cargos antiguos también mencionan compras que
  no tienen registro interno vinculado.
- Revisar el posible doble pago de Marcos Roku `#162` del 2026-07-09: tx
  `1173202` y `1173203`, ambos por USD 14.700 con referencia `Manual`. Fueron
  creados con 40 segundos de diferencia, pero Cash Flow no aporta una fila que
  pruebe si corresponde conservar uno o los dos. No se elimina ninguno sin
  comprobante.
- Las 30 cuentas con solo ajuste histórico, las 19 con ajuste mixto y las 3
  sin fuente financiera quedan visibles en cada sincronización. No se deben
  considerar conciliadas ni modificar hasta contar con evidencia externa.
- Los reportes `PENDING_SOURCE_EVIDENCE_2026-07-18.md` y
  `CASHFLOW_SOURCE_SCOPE_2026-07-18.md` reúnen los casos que no pueden cerrarse
  sin comprobante, junto con las fuentes habilitadas para cada revisión. El
  Invoice `#2352` de Luca tiene dos cargos respaldados en la cuenta histórica;
  permanece visible como referencia compartida, pero no se elimina como
  duplicado.
- `CLIENT_ACCOUNT_REVIEW_QUEUE_2026-07-18.md` enumera las 52 cuentas que no
  pueden marcarse como conciliadas automáticamente, ordenadas por tipo de
  evidencia faltante y saldo. Las 11 cuentas conectadas a Cash Flow y las 5
  cuentas con saldo cero confirmado ya están conciliadas.

## Etapa 6: Evidencia y cierre de conciliaciones

### Implementado

- Centro administrativo de evidencia por cuenta: permite registrar el tipo de
  respaldo, referencia, observación y adjuntar Invoice, recibo o comprobante
  bancario sin alterar Google Sheets ni movimientos existentes.
- Los adjuntos se validan en servidor (PDF, JPG, PNG o WEBP; máximo 8 MB), se
  validan por firma real, se vinculan a la cuenta y pueden asociarse al
  movimiento exacto.
- La descarga de cada respaldo queda protegida: solo usuarios administradores
  autenticados pueden verlo y se entrega como descarga privada.
- El alta de evidencia y su vínculo con la cuenta se realizan en una única
  transacción; una prueba de reversión confirma que un error no deja archivos
  ni registros parciales.
- La base bloquea por sí misma la asociación de evidencia a un movimiento de
  otra cuenta. Si el movimiento se elimina, conserva el respaldo y una copia
  de su referencia, fecha, tipo e importe para mantener trazabilidad.
- El sistema detecta el mismo comprobante por huella criptográfica y requiere
  confirmación explícita antes de reutilizarlo; un recibo reutilizado entre
  cuentas exige además una nota justificativa.

### Pendiente

- Cargar y revisar documentación para las 52 cuentas de la cola. La evidencia
  debe permitir decidir cada corrección de forma individual; no se aplicará
  ningún ajuste masivo de saldo.
- Resolver primero los tres saldos operativos sin fuente financiera vigente:
  Jose JR, Nicolas - AudioPhones y Nicolas Iphone Bsas.
- Revaluar el posible doble pago de Marcos Roku solo cuando exista el
  comprobante de los movimientos `1173202` y `1173203`.
