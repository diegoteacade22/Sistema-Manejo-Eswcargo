# Módulo de Compras (Bosquejo Dev)

## Objetivo
Resolver asignación parcial de una compra a distintos clientes usando proveedores y SKUs existentes.

Ejemplo: compro 10 iPad de un proveedor y asigno 4 a Cliente A + 6 a Cliente B.

## Estado actual (base real)
- Ya existen modelos `Purchase` y `PurchaseItem` en Prisma.
- Ya existen `Supplier`, `Product`, `Client`, `Order`, `OrderItem`.
- Hoy la carga comercial fuerte está en `Nueva Venta` (`/orders/new`), donde se setea proveedor/invoice por ítem, pero no hay un flujo explícito de "compra central" y luego "partición por cliente".

## Problema a resolver
- Evitar errores al repartir cantidades por cliente.
- Evitar errores de color/grado y SKU al asignar.
- Permitir sobrantes/cancelaciones sin obligar a manejo de stock completo.

## Propuesta MVP (sin inventario complejo)

### 1) Nueva pantalla: Compras
- Ruta nueva: `/purchases`
- Lista de compras con:
  - Fecha, proveedor, invoice, total ítems
  - Cantidad comprada
  - Cantidad asignada
  - Cantidad pendiente
  - Estado: `ABIERTA`, `PARCIAL`, `CERRADA`

### 2) Crear compra
- Ruta: `/purchases/new`
- Formulario:
  - Proveedor (de tabla existente)
  - Invoice (opcional)
  - Fecha
  - Ítems por SKU (selector de producto existente)
  - Cantidad y costo unitario
- Validaciones:
  - Cantidad > 0
  - SKU existente
  - No duplicar SKU en la misma compra (sumar en la misma línea)

### 3) Asignar compra a clientes (core)
- Ruta: `/purchases/[id]`
- Por cada ítem comprado mostrar:
  - SKU, nombre, color/grade
  - Cantidad comprada
  - Ya asignada
  - Pendiente
- Bloque "Asignar":
  - Cliente
  - Cantidad a asignar
  - Precio venta sugerido (editable)
  - Botón `Asignar`
- Regla principal:
  - No permitir asignar más que el pendiente.

### 4) Qué crea internamente cada asignación
Cada asignación genera (MVP):
- 1 `Order` (si no hay un pedido abierto del cliente para esa compra) o agrega ítem a uno existente.
- 1 `OrderItem` con referencia a:
  - `productId`
  - `supplierId` (desde la compra)
  - `purchase_invoice` (desde la compra)
  - cantidad/costos heredados de la compra
- Estado inicial sugerido del item: `ENCARGADO` o `RESERVADO` (definimos uno)

## Ajuste de datos mínimo recomendado
Agregar una tabla de vínculo explícito para trazabilidad:

### `PurchaseAllocation` (nueva)
Campos sugeridos:
- `id`
- `purchaseItemId`
- `clientId`
- `orderId` (nullable al inicio)
- `orderItemId` (nullable al inicio)
- `quantity`
- `unit_cost_snapshot`
- `unit_price_snapshot`
- `notes`
- `createdAt`

Ventajas:
- Sabemos exactamente cómo se repartió cada compra.
- Podemos recalcular pendientes sin depender de texto en invoice.
- Soporta cancelaciones/devoluciones con reversa clara.

## Reglas funcionales clave
1. **Pendiente nunca negativo**: 
   `pendiente = comprado - sum(asignado)`.
2. **Asignación parcial permitida**: cualquier split mientras no exceda pendiente.
3. **Cancelación de asignación** (MVP fase 2):
   - revierte cantidad asignada al pendiente.
   - opcional: anula/elimina `OrderItem` asociado si quedó en 0.
4. **Color/grade visible siempre**:
   - al elegir SKU, mostrar `color_grade` del producto.
5. **Sin stock global obligatorio**:
   - sólo control por compra (lote), no inventario total del negocio.

## Flujo operativo sugerido
1. Registro compra a proveedor.
2. Sistema deja compra en `ABIERTA`.
3. Se asignan unidades a 1 o varios clientes.
4. Si queda remanente: estado `PARCIAL`.
5. Si se asigna todo: estado `CERRADA`.
6. Si cliente cancela: se revierte asignación y vuelve a pendiente.

## Fases de implementación

### Fase 1 (rápida, usable)
- Pantallas `/purchases`, `/purchases/new`, `/purchases/[id]`.
- Crear compra + asignar a clientes.
- Validación de pendiente.
- Crear pedidos/items automáticamente al asignar.

### Fase 2 (control y correcciones)
- Editar/revertir asignaciones.
- Historial de asignaciones por compra e ítem.
- Filtros por proveedor, cliente, estado.

### Fase 3 (mejoras opcionales)
- Sugerencia inteligente de cliente por historial.
- Alertas de diferencias de color/grade.
- Reporte de remanentes por antigüedad.

## Impacto en UX actual
- `Nueva Venta` sigue existiendo.
- Nueva opción recomendada para ventas nacidas desde compra real: “Crear desde Compra”.
- Menos errores humanos al repartir cantidades y colores.

## Riesgos y mitigaciones
- Riesgo: doble carga (compras + ventas manuales).
  - Mitigación: botón rápido “Asignar y crear pedido” en un paso.
- Riesgo: datos históricos sin vínculo.
  - Mitigación: operar nuevo flujo sólo desde fecha de activación.

## Criterios de éxito MVP
- Puedo cargar una compra con N unidades por SKU.
- Puedo repartir esas unidades entre múltiples clientes sin pasarme.
- Veo pendiente real por ítem en todo momento.
- Cada asignación queda trazada a pedido/cliente.
