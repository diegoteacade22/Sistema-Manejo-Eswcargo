# 🤖 Sistema de Agentes Especializados

Este directorio contiene la configuración y documentación para trabajar con **agentes especializados** en el desarrollo del Sistema de Gestión de Importaciones.

---

## 📁 Estructura

```
.agent/
├── MULTI_AGENT_ARCHITECTURE.md  # Arquitectura completa
├── QUICK_START.md                # Guía rápida de uso
├── configs/                       # Configuraciones de agentes
│   ├── ui-agent-config.md
│   ├── backend-agent-config.md
│   ├── db-agent-config.md
│   ├── sync-agent-config.md
│   └── [más configs]
├── workflows/                     # Workflows predefinidos
│   └── [workflows .md]
└── templates/                     # Templates de código
    └── [templates .tsx/.py]
```

---

## 🚀 Inicio Rápido

### 1. Lee la arquitectura
```bash
cat .agent/MULTI_AGENT_ARCHITECTURE.md
```

### 2. Aprende a usar agentes
```bash
cat .agent/QUICK_START.md
```

### 3. Revisa configs de cada agente
```bash
ls .agent/configs/
```

---

## 🎯 Agentes Disponibles

| Agente | Comando | Archivo Config |
|--------|---------|---------------|
| **UI/Frontend** | `@ui-agent` | `configs/ui-agent-config.md` |
| **Backend** | `@backend-agent` | `configs/backend-agent-config.md` |
| **Database** | `@db-agent` | `configs/db-agent-config.md` |
| **Sync** | `@sync-agent` | `configs/sync-agent-config.md` |
| **DevOps** | `@devops-agent` | `configs/devops-agent-config.md` |
| **QA/Testing** | `@qa-agent` | `configs/qa-agent-config.md` |
| **Docs** | `@docs-agent` | `configs/docs-agent-config.md` |

---

## 💡 Ejemplo de Uso

```
# Cambio simple de UI
@ui-agent "Mejora el botón de guardar con sombra y animación"

# Cambio de esquema
@db-agent "Agrega campo instagram a Client"

# Feature completa (orquestada)
@orchestrator "Implementa notificaciones por email"
```

---

## 📚 Documentación

- **Arquitectura:** [MULTI_AGENT_ARCHITECTURE.md](./MULTI_AGENT_ARCHITECTURE.md)
- **Guía rápida:** [QUICK_START.md](./QUICK_START.md)
- **Configs:** [configs/](./configs/)

---

## ✨ Beneficios

- ⚡ **60-70% más rápido** en cambios simples
- 🎯 **Agentes especializados** en su dominio
- 🛡️ **Menos errores** por cambios aislados
- 📦 **Hot reload** solo del módulo afectado
- 🧠 **Menor overhead** cognitivo

---

**Última actualización:** 26 de Diciembre, 2025  
**Proyecto:** Sistema de Gestión de Importaciones
