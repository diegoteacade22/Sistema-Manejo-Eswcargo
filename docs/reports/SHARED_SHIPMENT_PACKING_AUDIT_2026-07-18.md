# Auditoría de Packing List compartidos - 2026-07-18

Verificación de solo lectura contra `VENTAS - COMPRAS 2025-2026` y producción.
No se modificaron Google Sheets ni datos operativos.

## Hallazgos verificados

| Envío | Cliente | Pedidos | Unidades exactas |
| ---: | --- | --- | ---: |
| 1188 | Ramiro Star Computacion | 2529, 2521 | 10 |
| 1188 | Marcos Roku | 2540 | 6 |
| 1204 | Ramiro Star Computacion | 2551, 2529 | 11 |
| 1204 | Franco Visciarelli | 2559 | 2 |

El total de `#1188` es 16, pero está repartido entre Ramiro (10) y Marcos (6).
Por eso no corresponde mostrar 16 unidades a Ramiro.

## Regla productiva

1. Cuando un envío contenga artículos de más de un cliente, el sistema exige
   elegir el cliente antes de imprimir, guardar o enviar el Packing List.
2. El documento se proyecta desde sus artículos y pedidos confirmados, sin
   mezclar los de otros clientes.
3. Si la última sincronización rechaza sólo la cabecera por ser compartida,
   el Packing por cliente sigue disponible, pero no muestra peso ni cargo común.
4. Si existe otro rechazo de fuente, un pedido rechazado, un artículo sin
   cliente o falta el contenido, se bloquea el documento.
5. Los envíos automáticos se omiten para documentos compartidos hasta contar
   con una notificación independiente por cliente.

## Casos sin contenido

- `#1215`: la fuente no aporta artículos; queda bloqueado.
- `#1048`: la fuente no aporta artículos confirmados; queda bloqueado.

## Pendiente de fuente

Las 13 colisiones de cabecera siguen pendientes de corregir en la fuente.
La segmentación evita Packing incorrectos, pero no inventa ni atribuye pesos,
costos, fechas ni otra información común de cabecera.
