# Reglas de Transición de Estados Automáticos

Este documento actúa como la fuente de verdad para la lógica de estados automáticos del sistema de importaciones.

## Estados de Pedidos
| Estado | Color Ref | Descripción |
| :--- | :--- | :--- |
| **COMPRAR** | Rojo | Pedido recién ingresado. |
| **ENCARGADO** | Verde Oscuro | Compra realizada al proveedor. |
| **SALIENDO** | Naranja | El envío ha salido de origen. |
| **LLEGANDO** | Púrpura | En tránsito (automático a las 48h de salida). |
| **EN 🇦🇷** | Cian | El envío ha arribado a Aduana/BSAS. |
| **ENTREGADO** | Celeste | Cliente recibió el producto (automático a los 3 días de arribo). |

## Reglas de Automatización de Envíos

La lógica de estados de un **Envío** (y sus pedidos asociados) se rige por las fechas ingresadas:

1.  **SALIENDO**: Se asigna automáticamente si existe una `Fecha de Salida`.
2.  **LLEGANDO**: Se asigna automáticamente **48 horas después** de la `Fecha de Salida`, basándose en el reloj actual.
3.  **EN 🇦🇷**: Se asigna automáticamente si existe una `Fecha de Arribo`.
4.  **ENTREGADO**: 
    - Puede modificarse **manualmente**.
    - Se asigna automáticamente **3 días después** de la `Fecha de Arribo` (para evitar omisiones).

## Sincronización en Cascada
- Cuando el estado de un **Envío** cambia a `ENTREGADO`, todos los **Pedidos** y **Items** asociados deben pasar automáticamente a `ENTREGADO`.
