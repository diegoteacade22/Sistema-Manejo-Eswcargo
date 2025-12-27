# 🤖 Arquitectura de Agentes Especializados - Sistema de Gestión de Importaciones

## 🎯 Visión General

Este proyecto usa una **arquitectura multi-agente** donde diferentes agentes especializados manejan áreas específicas del sistema, permitiendo desarrollo paralelo y eficiente.

---

## 🏗️ Estructura de Agentes

### 1. 🎨 **UI/Frontend Agent** (`@ui-agent`)
**Responsabilidad:** Componentes visuales, páginas, diseño y experiencia de usuario

**Dominio:**
- `/webapp/components/` - Todos los componentes React
- `/webapp/app/**/page.tsx` - Páginas de Next.js
- `/webapp/app/**/layout.tsx` - Layouts
- Estilos y temas
- Diseño responsive

**Comandos:**
```bash
# Trabajar solo en UI
@ui-agent "Mejora el diseño del formulario de clientes"
@ui-agent "Agrega un componente de gráfico para ventas"
```

**No toca:**
- Lógica de base de datos
- Server actions
- Scripts de Python

---

### 2. ⚙️ **Backend Agent** (`@backend-agent`)
**Responsabilidad:** Server actions, API routes, lógica de negocio

**Dominio:**
- `/webapp/app/actions.ts` - Server actions
- `/webapp/app/auth-actions.ts` - Autenticación
- `/webapp/lib/` - Utilidades y helpers
- Validaciones y reglas de negocio

**Comandos:**
```bash
# Trabajar solo en backend
@backend-agent "Agrega validación de email en createClient"
@backend-agent "Crea una función para calcular deuda total"
```

**No toca:**
- Componentes visuales
- Estilos CSS
- Scripts Python

---

### 3. 🗄️ **Database Agent** (`@db-agent`)
**Responsabilidad:** Schema, migraciones, seed data, consultas Prisma

**Dominio:**
- `/webapp/prisma/schema.prisma` - Schema de BD
- `/webapp/prisma/seed*.ts` - Scripts de seed
- Migraciones de Prisma
- Optimización de queries

**Comandos:**
```bash
# Trabajar solo en BD
@db-agent "Agrega campo 'instagram' al modelo Client"
@db-agent "Crea índice para búsquedas por email"
@db-agent "Optimiza query de clientes con deuda"
```

**No toca:**
- Componentes UI
- Python scripts
- Configuración de deploy

---

### 4. 🔄 **Sync Agent** (`@sync-agent`)
**Responsabilidad:** Sincronización Excel ↔ BD, scripts Python

**Dominio:**
- `/extract_*.py` - Scripts de extracción
- `/export_to_excel.py` - Exportación
- `/sync.sh` - Orquestación
- Lógica bidireccional

**Comandos:**
```bash
# Trabajar solo en sincronización
@sync-agent "Agrega exportación de productos a Excel"
@sync-agent "Mejora manejo de errores en extract_clients.py"
```

**No toca:**
- Schema de Prisma directamente
- Componentes React
- Server actions

---

### 5. 🚀 **DevOps Agent** (`@devops-agent`)
**Responsabilidad:** Deploy, configuración, variables de entorno, CI/CD

**Dominio:**
- `next.config.ts` - Configuración Next.js
- `.env` files
- Vercel configuration
- GitHub Actions (si aplica)
- Docker (si aplica)

**Comandos:**
```bash
# Trabajar solo en DevOps
@devops-agent "Configura variable de entorno para SMTP"
@devops-agent "Optimiza build de producción"
@devops-agent "Agrega health check endpoint"
```

**No toca:**
- Lógica de negocio
- Componentes
- Base de datos

---

### 6. 🧪 **QA/Testing Agent** (`@qa-agent`)
**Responsabilidad:** Testing, validación, verificación de bugs

**Dominio:**
- Tests unitarios
- Tests de integración
- Browser testing
- Verificación de bugs
- Performance testing

**Comandos:**
```bash
# Trabajar solo en QA
@qa-agent "Verifica que el formulario de clientes valide emails"
@qa-agent "Prueba el flujo completo de crear una orden"
@qa-agent "Detecta memory leaks en la página de dashboard"
```

**No toca:**
- Implementación de features
- Solo reporta y sugiere fixes

---

### 7. 📚 **Documentation Agent** (`@docs-agent`)
**Responsabilidad:** Documentación, READMEs, guías de uso

**Dominio:**
- Todos los archivos `.md`
- Comentarios en código
- Guías de deployment
- Tutoriales

**Comandos:**
```bash
# Trabajar solo en documentación
@docs-agent "Actualiza DEPLOYMENT_GUIDE.md con nuevo paso"
@docs-agent "Documenta el flujo de sincronización"
```

**No toca:**
- Código funcional
- Solo documenta

---

## 🎭 Agente Orquestador (`@orchestrator`)

**Responsabilidad:** Coordinar tareas que requieren múltiples agentes

**Uso:**
```bash
# El orquestador delega automáticamente
@orchestrator "Agrega campo 'telefono_secundario' al cliente y muéstralo en el formulario"

# Internamente:
# 1. @db-agent: Agrega campo al schema
# 2. @backend-agent: Actualiza server actions
# 3. @ui-agent: Agrega input al formulario
# 4. @qa-agent: Verifica el cambio
```

---

## 📋 Workflow Ejemplo

### Tarea: "Agregar campo de Instagram a clientes"

#### Enfoque Tradicional (1 agente):
```
Usuario: "Agrega campo de instagram a clientes"
→ Agente modifica schema, UI, actions, actualiza docs
→ Se ejecutan todas las migraciones
→ Reinicia el servidor
→ Mucho overhead
```

#### Enfoque Multi-Agente:
```
# Paso 1: Schema
@db-agent "Agrega campo 'instagram' STRING opcional a Client"
→ Solo modifica schema.prisma
→ Genera migración
→ No toca nada más

# Paso 2: Backend (si necesario)
@backend-agent "Actualiza createClient para aceptar instagram"
→ Solo modifica actions.ts
→ No reinicia servidor

# Paso 3: UI
@ui-agent "Agrega input de Instagram al formulario de cliente"
→ Solo modifica edit-client-dialog.tsx
→ Hot reload instantáneo

# Paso 4: Verificación
@qa-agent "Verifica que el campo de Instagram se guarde correctamente"
→ Solo prueba, no modifica

# Paso 5: Docs
@docs-agent "Documenta el nuevo campo en SCHEMA.md"
→ Solo actualiza markdown
```

**Ventajas:**
- ✅ Cada agente es experto en su área
- ✅ Cambios más rápidos y precisos
- ✅ Menos conflictos y side effects
- ✅ Paralelización posible

---

## 🛠️ Implementación Práctica

### Opción 1: Usar contexto/prefijos

En cada conversación, especifica el agente:
```
"Como @ui-agent, mejora el diseño del botón de guardar"
```

### Opción 2: Archivos de configuración por agente

Crear `.agent/` directory con configs:
```
.agent/
  ├── ui-agent-config.yaml
  ├── backend-agent-config.yaml
  ├── db-agent-config.yaml
  └── sync-agent-config.yaml
```

### Opción 3: Workflows automáticos

Crear workflows en `.agent/workflows/`:
```
.agent/workflows/
  ├── add-field-to-client.md
  ├── create-new-page.md
  └── sync-excel-data.md
```

---

## 📊 Matriz de Responsabilidades

| Archivo/Directorio | UI | Backend | DB | Sync | DevOps | QA | Docs |
|-------------------|----|---------|----|------|--------|----|----- |
| `/components/` | ✅ | ❌ | ❌ | ❌ | ❌ | 👁️ | 📝 |
| `/app/actions.ts` | ❌ | ✅ | 🤝 | ❌ | ❌ | 👁️ | 📝 |
| `schema.prisma` | ❌ | 🤝 | ✅ | 🤝 | ❌ | 👁️ | 📝 |
| `extract_*.py` | ❌ | ❌ | ❌ | ✅ | ❌ | 👁️ | 📝 |
| `next.config.ts` | ❌ | ❌ | ❌ | ❌ | ✅ | 👁️ | 📝 |
| `*.md` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |

**Leyenda:**
- ✅ Responsabilidad principal
- 🤝 Colaboración necesaria
- 👁️ Solo observa/verifica
- 📝 Documenta cambios

---

## 🚦 Reglas de Coordinación

### 1. **Un agente, una responsabilidad**
Cada agente debe enfocarse SOLO en su dominio.

### 2. **Comunicación clara entre agentes**
Si `@ui-agent` necesita datos de BD, pide a `@db-agent` primero.

### 3. **Rollback independiente**
Cada agente puede hacer rollback de sus cambios sin afectar a otros.

### 4. **Testing antes de merge**
Antes de integrar cambios de múltiples agentes, `@qa-agent` verifica.

---

## 💡 Comandos Rápidos

```bash
# Desarrollo UI puro
@ui-agent "Rediseña la página de clientes con dark mode"

# Cambio de schema
@db-agent "Migra el campo 'phone' de Client a tipo Phone separado"

# Nueva feature completa (orquestador)
@orchestrator "Implementa sistema de notificaciones por email"
# → Delega a: @db-agent, @backend-agent, @ui-agent, @devops-agent

# Bug fix específico
@backend-agent "Corrige validación de DNI/CUIT en createClient"

# Optimización
@db-agent "Agrega índice compuesto para búsquedas frecuentes"

# Sincronización
@sync-agent "Actualiza extract_orders.py para manejar nuevos estados"
```

---

## 📈 Beneficios Medibles

### Antes (1 agente monolítico):
- ⏱️ Cambio simple: 5-10 minutos
- 🔄 Reinicio completo del servidor
- 🐛 Riesgo alto de romper cosas no relacionadas
- 📚 Overhead de contexto enorme

### Después (Multi-agente):
- ⚡ Cambio simple: 1-2 minutos
- 🎯 Hot reload solo del módulo afectado
- 🛡️ Cambios aislados, menos side effects
- 🧠 Contexto reducido, agente especializado

**Mejora estimada: 60-70% más rápido**

---

## 🎯 Próximos Pasos

### 1. Configurar estructura de agentes
```bash
# Crear directorio de configuración
mkdir -p .agent/{configs,workflows}
```

### 2. Definir workflows comunes
Crear archivos como:
- `add-new-field.md`
- `create-crud-page.md`
- `deploy-to-vercel.md`

### 3. Entrenar contexto de cada agente
Cada agente debe conocer:
- Su dominio específico
- Sus limitaciones
- Con quién coordinar

### 4. Establecer protocolo de comunicación
Definir cómo los agentes se pasan información.

---

**Última actualización:** 26 de Diciembre, 2025  
**Versión:** 1.0 - Arquitectura Multi-Agente  
**Proyecto:** Sistema de Gestión de Importaciones
