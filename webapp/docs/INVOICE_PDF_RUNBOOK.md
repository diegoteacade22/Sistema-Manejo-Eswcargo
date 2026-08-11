# Invoice PDF: diagnóstico y recuperación

## Regla de identificación

- `order_number` es el número comercial, por ejemplo `INV 2595`.
- `Order.id` es la clave interna usada por las rutas. Para INV 2595 la ruta es `/orders/11673/invoice`.
- El buscador de pedidos acepta `2595`, `#2595`, `INV 2595` e `INVOICE 2595`.

## Guardado seguro

En producción no se debe escribir un PDF en una ruta local del servidor de Vercel: ese filesystem no es el Google Drive del usuario y no es persistente. El botón **Descargar PDF** obtiene el documento desde la ruta autenticada `/api/orders/[id]/invoice` y lo guarda mediante el navegador.

## Verificación antes de entregar

1. Leer el pedido por `order_number` y anotar su `Order.id`.
2. Comparar cantidad de renglones, suma de unidades y suma de subtotales.
3. Abrir `/orders/<Order.id>/invoice`.
4. Descargar el PDF y verificar visualmente que todos los renglones estén presentes, que `Total PCS` sume unidades y que el total coincida con el pedido.
5. Si la fuente rechaza una reducción de detalle, conservar el pedido previo y revisar el Sheet; no ejecutar una actualización histórica destructiva.
