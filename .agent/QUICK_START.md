# 🚀 Guía Rápida: Usando Agentes Especializados

## 📖 Introducción

Este proyecto usa **agentes especializado**s para desarrollo más eficiente. Cada agente tiene su dominio y no interfiere con otros.

---

## 🎯 Agentes Disponibles

| Agente | Comando | Responsabilidad |
|--------|---------|-----------------|
| **UI Agent** | `@ui-agent` | Componentes, páginas, diseño |
| **Backend Agent** | `@backend-agent` | Server actions, lógica de negocio |
| **DB Agent** | `@db-agent` | Schema, migraciones, seeds |
| **Sync Agent** | `@sync-agent` | Excel ↔ BD sincronización |
| **DevOps Agent** | `@devops-agent` | Deploy, config, CI/CD |
| **QA Agent** | `@qa-agent` | Testing, verificación |
| **Docs Agent** | `@docs-agent` | Documentación |

---

## 💡 Ejemplos de Uso

### ✨ Cambios Simples

#### Mejorar diseño de un componente
```
@ui-agent "Mejora el diseño del botón de guardar en edit-client-dialog.tsx con sombra y hover effect"
```
**Resultado:** Solo modifica el componente, hot reload instantáneo

#### Agregar validación
```
@backend-agent "Agrega validación de DNI/CUIT argentino en createClient (formato: XX-XXXXXXXX-X)"
```
**Resultado:** Solo modifica actions.ts, sin tocar UI

#### Agregar campo a modelo
```
@db-agent "Agrega campo 'website' tipo String opcional al modelo Client"
```
**Resultado:**
- Modifica schema.prisma
- Genera migración
- Actualiza Prisma client

---

### 🔧 Tareas Complejas (requieren coordinación)

#### Agregar nuevo campo completo
```
Paso 1:
@db-agent "Agrega campo 'secondaryPhone' String opcional a Client"

Paso 2 (después que @db-agent termine):
@backend-agent "Actualiza createClient y updateClient para manejar secondaryPhone"

Paso 3:
@ui-agent "Agrega input para secondaryPhone en el formulario de clientes"

Paso 4:
@sync-agent "Actualiza extract_clients.py para importar TEL_SECUNDARIO desde Excel"

Paso 5:
@qa-agent "Verifica que secondaryPhone funcione de punta a punta"
```

---

## 🎭 Usando el Orquestador

Para tareas que spans múltiples dominios, usa `@orchestrator`:

```
@orchestrator "Implementa sistema de notificaciones por email para clientes con deuda"
```

El orquestador automáticamente:
1. **@db-agent**: Crea modelo Notification
2. **@backend-agent**: Implementa lógica de envío de emails
3. **@ui-agent**: Agrega panel de notificaciones
4. **@devops-agent**: Configura SMTP en variables de entorno
5. **@qa-agent**: Verifica el flujo completo

---

## 📋 Workflows Comunes

### Workflow 1: Nueva Página CRUD

```bash
# Paso 1: Schema
@db-agent "Crea modelo Product con: name, description, price, stock"

# Paso 2: Server Actions
@backend-agent "Crea server actions: createProduct, updateProduct, deleteProduct, getProducts"

# Paso 3: UI
@ui-agent "Crea página /products con tabla y formulario para CRUD de productos"

# Paso 4: Test
@qa-agent "Verifica flujo completo de productos: crear, editar, eliminar, listar"
```

### Workflow 2: Sincronizar Nueva Entidad

```bash
# Paso 1: Preparar schema
@db-agent "Revisa si modelo Product existe, si no, créalo"

# Paso 2: Script de extracción
@sync-agent "Crea extract_products.py para importar desde hoja PRODUCTOS en Excel"

# Paso 3: Script de seed
@db-agent "Crea seed_products.ts usando products_seed.json"

# Paso 4: Orquestación
@sync-agent "Actualiza sync.sh para incluir sincronización de productos"
```

### Workflow 3: Fix de Bug

```bash
# Paso 1: Reportar
@qa-agent "Verifica si el formulario de clientes valida emails correctamente"

# Respuesta: "❌ No valida, acepta emails inválidos"

# Paso 2: Fix
@backend-agent "Agrega validación de email usando Zod en createClient"

# Paso 3: Re-test
@qa-agent "Re-verifica validación de emails después del fix"
```

---

## 🚦 Reglas de Oro

### ✅ **DO (Hacer)**

1. **Sé específico con el agente**
   ```
   ✅ @ui-agent "Cambia el color del botón Guardar a verde"
   ❌ "Cambia el color del botón" (¿qué agente?)
   ```

2. **Un agente, una tarea**
   ```
   ✅ @db-agent "Agrega índice en Client.email"
   ❌ @db-agent "Agrega índice Y crea el formulario" (mezcla dominios)
   ```

3. **Coordina cuando sea necesario**
   ```
   ✅ @db-agent primero, luego @backend-agent, luego @ui-agent
   ❌ Todos en paralelo sin coordinación
   ```

4. **Verifica con QA**
   ```
   ✅ @qa-agent después de cambios importantes
   ❌ Asumir que funciona sin verificar
   ```

### ❌ **DON'T (No hacer)**

1. **No pidas a un agente que modifique fuera de su dominio**
   ```
   ❌ @ui-agent "Modifica la validación en actions.ts"
   ✅ @backend-agent "Modifica la validación en actions.ts"
   ```

2. **No mezcles responsabilidades**
   ```
   ❌ @ui-agent "Crea el componente Y la migración de BD"
   ✅ @db-agent + @ui-agent (en pasos separados)
   ```

3. **No hagas cambios sin documentar**
   ```
   ❌ Hacer cambios sin actualizar docs
   ✅ @docs-agent "Documenta el nuevo campo 'instagram' en SCHEMA.md"
   ```

---

## 📊 Comparación: Antes vs Después

### Antes (1 Agente Monolítico)

```
Usuario: "Agrega campo instagram a clientes"

Agente:
  1. Modifica schema.prisma
  2. Genera migración
  3. Actualiza actions.ts
  4. Modifica edit-client-dialog.tsx
  5. Actualiza extract_clients.py
  6. Actualiza export_to_excel.py
  7. Documenta cambios
  8. Reinicia servidor completo

Tiempo: 10-15 minutos
Riesgo: Alto (puede romper cosas no relacionadas)
```

### Después (Multi-Agente)

```
Usuario: "Agrega campo instagram a clientes"

@db-agent: Modifica schema y migra (1 min)
@backend-agent: Actualiza actions (30 seg)
@ui-agent: Agrega input al form (1 min)
@sync-agent: Actualiza extract/export (1 min)
@qa-agent: Verifica (30 seg)
@docs-agent: Documenta (30 seg)

Tiempo: ~5 minutos
Riesgo: Bajo (cambios aislados)

Ventaja: 50-60% más rápido, mucho más seguro
```

---

## 🎯 Tips Pro

### Tip 1: Usa el agente correcto desde el inicio
```
❌ "Agrega instagram"
✅ "@db-agent Agrega campo instagram String opcional a Client"
```

### Tip 2: Coordina en orden lógico
```
1. @db-agent (schema)
2. @backend-agent (lógica)
3. @ui-agent (presentación)
4. @sync-agent (datos)
5. @qa-agent (verificación)
```

### Tip 3: Para bugs, empieza con QA
```
@qa-agent "Reproduce el bug: el email no se guarda al editar cliente"
# QA agent identifica dónde está el problema
# Luego llama al agente correcto para el fix
```

### Tip 4: Usa Orchestrator para features grandes
```
@orchestrator "Implementa dashboard con gráficos de ventas mensuales"
# Delega automáticamente a múltiples agentes
```

---

## 📚 Recursos

- **Arquitectura completa:** `.agent/MULTI_AGENT_ARCHITECTURE.md`
- **Configs de agentes:** `.agent/configs/*-agent-config.md`
- **Workflows:** `.agent/workflows/*.md`
- **Templates:** `.agent/templates/*.tsx`

---

## ❓ FAQs

**Q: ¿Puedo usar el agente "equivocado"?**  
A: Sí, pero será menos eficiente. El agente te dirá si algo está fuera de su dominio.

**Q: ¿Qué pasa si dos agentes necesitan modificar el mismo archivo?**  
A: Coordínalos secuencialmente, no en paralelo. Ejemplo: @db-agent primero, luego @backend-agent.

**Q: ¿Cómo sé qué agente usar?**  
A: Mira la matriz de responsabilidades en `MULTI_AGENT_ARCHITECTURE.md`

**Q: ¿El Orchestrator reemplaza a los agentes individuales?**  
A: No, el Orchestrator DELEGA a los agentes. Sigue siendo útil usarlos directamente.

---

## ✅ Checklist de Inicio

Antes de empezar con agentes:

- [ ] Leído `MULTI_AGENT_ARCHITECTURE.md`
- [ ] Entendidos los 7 agentes y sus roles
- [ ] Revisado los ejemplos en esta guía
- [ ] Identificado qué agente(s) usar para tu tarea
- [ ] Listo para trabajar de manera eficiente

---

**¡Listo para empezar!** 🚀

Usa `@<agent-nombre>` al inicio de tus solicitudes para trabajar con agentes especializados.

**Última actualización:** 26 de Diciembre, 2025
