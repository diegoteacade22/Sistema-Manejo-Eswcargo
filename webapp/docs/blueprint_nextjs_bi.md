# Blueprint de Desarrollo de Aplicaciones de Inteligencia de Negocio (BI)
## Basado en el Proyecto: Sistema de Gestión de Importaciones (Antigravity Standard)

Este documento resume la metodología, arquitectura y estándares de diseño establecidos durante el desarrollo de este sistema. Utilícese como plantilla para futuros proyectos en cartera.

---

### 1. Stack Tecnológico de Referencia
*   **Base:** Next.js 14+ (App Router).
*   **Base de Datos:** PostgreSQL vía Supabase.
*   **ORM:** Prisma (para consultas tipadas y seguras).
*   **Estilo:** Tailwind CSS + Shadcn UI (Customizado).
*   **Iconografía:** Lucide React.
*   **Visualización:** Recharts (para gráficos reactivos).
*   **Backend:** Server Actions (Separación clara en `actions.ts` y `analytics-actions.ts`).

---

### 2. Principios de Diseño Aestético (Premium Mode)
*   **Vibrancia:** Uso de colores saturados para indicadores clave (Esmeralda para ganancias, Índigo para ventas, Rojo para alertas).
*   **Glastmorphism:** Fondos con semi-transparencia (`bg-white/10`) y desenfoque (`backdrop-blur`) en tarjetas oscuras.
*   **Tipografía:** Priorizar fuentes sans-serif modernas (Inter u Outfit) con pesos pesados (`font-black`) para números de KPI.
*   **Micro-interacciones:** Todas las secciones deben tener animaciones de entrada (`animate-in fade-in slide-in`).
*   **Modo Oscuro Dirigido:** En secciones BI, usar fondos `slate-900` para resaltar gráficos de colores brillantes.

---

### 3. Arquitectura de Datos de Negocio
No mostrar solo "datos", mostrar **inteligencia**. Cada módulo analítico debe seguir este patrón:
1.  **KPIs Directos (Hero Section):** Los 4 números más importantes del área.
2.  **Visualización Temporal:** Gráficos de barras o áreas comparando los últimos 6 meses.
3.  **Auditoría / Clave Estratégica:** Una tarjeta que interprete los datos (ej: "Tu margen neto está bajando, revisa el pricing").
4.  **Matriz de Acción:** Tablas o listas que obliguen a una decisión (ej: "Clientes en riesgo a los que llamar hoy").

---

### 4. Índices Críticos de Crecimiento (KPI Standard)
Para cualquier proyecto futuro, implementar siempre estos índices:
*   **Finanzas:** MoM Growth (Crecimiento mensual), Efficiency Ratio (OpEx/Revenue), Burn Rate.
*   **Ventas:** LTV (Life Time Value), Retention Rate, Churn Risk (Probabilidad de abandono).
*   **Operaciones:** Rendimiento por unidad (Yield x KG o similar), Eficiencia de Proveedores.

---

### 5. Flujo de Desarrollo Recomendado
1.  **Auditoría de Esquema:** Asegurar que el `schema.prisma` soporte los cálculos derivados sin queries excesivamente complejas.
2.  **Business logic layer:** Crear funciones en `analytics-actions.ts` que pre-procesen los datos antes de enviarlos al cliente.
3.  **UI Core:** Implementar `Dashboard` general con señales preventivas (Alertas).
4.  **Módulos Especializados:** Crear páginas de analytics por rol (Ventas, Compras, Finanzas).
5.  **Polished & Performance:** Optimizar queries y añadir estados de carga de alta calidad (Skeletons o mensajes de análisis).

---
*Documento generado por Antigravity AI - Advanced Agentic Coding.*
