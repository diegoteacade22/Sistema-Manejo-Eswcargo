# 🔄 Sincronización Bidireccional - Sistema de Gestión de Importaciones

## Descripción

El sistema ahora implementa **sincronización bidireccional** entre la aplicación web y la planilla de Excel. Esto significa que:

✅ Los datos editados manualmente en la app **NO se borran** al sincronizar con Excel
✅ Los datos nuevos de Excel se importan normalmente
✅ Se aplica una estrategia de merge inteligente

---

## 🎯 Estrategia de Sincronización

### Clientes (seed_clients.ts)

#### Campos que SIEMPRE se actualizan desde Excel:
- **name** (Nombre del cliente)
- **type** (Tipo de cliente)

#### Campos que se preservan si fueron editados manualmente:
- **email** - Solo se actualiza si está vacío en BD y tiene valor en Excel
- **phone** - Solo se actualiza si está vacío en BD y tiene valor en Excel  
- **address** - Solo se actualiza si está vacío en BD y tiene valor en Excel
- **document_id** - Solo se actualiza si está vacío en BD y tiene valor en Excel

#### Campos que NUNCA se sobrescriben (solo edición manual):
- **city**
- **state**
- **country**
- **zipCode**
- **notes**
- **instagram**
- **webpage**

---

## 📋 Reglas de Merge

### Para actualizar un cliente existente:

```typescript
if (existe en BD) {
  // Siempre actualizar
  name ← desde Excel
  type ← desde Excel (si no está vacío)
  
  // Solo si está vacío en BD
  if (!bd.email && excel.email) → email ← desde Excel
  if (!bd.phone && excel.phone) → phone ← desde Excel
  if (!bd.address && excel.address) → address ← desde Excel
  
  // NUNCA actualizar (preservar ediciones manuales)
  city, state, country, zipCode, notes → mantener valores de BD
}
```

### Para crear un cliente nuevo:

```typescript
if (NO existe en BD) {
  // Crear con todos los datos disponibles desde Excel
  crear_cliente(todos_los_campos_desde_excel)
}
```

---

## 🔧 Cómo Sincronizar

### Paso 1: Extraer datos desde Excel
```bash
cd /Users/diegorodriguez/sistema_gestion_importaciones
python3 extract_clients.py
```

### Paso 2: Aplicar sincronización a la BD
```bash
cd webapp
npx tsx prisma/seed_clients.ts
```

---

## 📝 Ejemplo Práctico

### Escenario:

**En Excel (CLIENTES):**
- COD_CLI: 162
- NOMBRE: Marcos Roku
- MAIL: (vacío)
- TELEFONO: +54 9 11...

**En la Base de Datos:**
- old_id: 162
- name: Marcos Roku
- email: marcos@example.com ← **Editado manualmente**
- phone: +54 9 11...
- city: Buenos Aires ← **Editado manualmente**
- state: CABA ← **Editado manualmente**

### Resultado después de sincronizar:

```
✓ Updated client: Marcos Roku (preserved manual edits)
```

**Estado final en BD:**
- old_id: 162
- name: Marcos Roku ← Actualizado desde Excel
- email: marcos@example.com ← **PRESERVADO** (edición manual)
- phone: +54 9 11... ← Mantenido (ya existía)
- city: Buenos Aires ← **PRESERVADO** (edición manual)
- state: CABA ← **PRESERVADO** (edición manual)

---

## ⚠️ Casos Especiales

### Si quieres FORZAR una actualización desde Excel:

Si necesitas que un campo específico se actualice desde Excel incluso si tiene valor en BD, debes:

1. **Opción A:** Borrar manualmente el campo en la app antes de sincronizar
2. **Opción B:** Modificar temporalmente el script `seed_clients.ts` para ese campo específico

### Si quieres agregar un nuevo campo de Excel:

1. Agregar el campo en `extract_clients.py`
2. Agregar la lógica de merge en `seed_clients.ts`
3. Decidir si es un campo que se preserva o se actualiza siempre

---

## 🔍 Verificación

Para verificar que la sincronización funcionó correctamente:

```bash
# Revisar los logs del seed
npx tsx prisma/seed_clients.ts

# Verificar en la app
# Ir a http://localhost:3000/clients
# Editar un cliente (agregar email/teléfono)
# Ejecutar sincronización
# Verificar que los datos editados NO se borraron
```

---

## 📊 Campos por Entidad

### Clientes
| Campo | Excel → BD | BD → Excel | Preservar Manual |
|-------|-----------|-----------|-----------------|
| name | ✅ Siempre | ❌ No | ❌ No |
| email | ⚠️ Si vacío | ❌ No | ✅ Sí |
| phone | ⚠️ Si vacío | ❌ No | ✅ Sí |
| address | ⚠️ Si vacío | ❌ No | ✅ Sí |
| city | ❌ No | ❌ No | ✅ Sí |
| state | ❌ No | ❌ No | ✅ Sí |
| country | ❌ No | ❌ No | ✅ Sí |
| notes | ❌ No | ❌ No | ✅ Sí |

---

## 🚀 Próximos Pasos

Para hacer el sistema COMPLETAMENTE bidireccional:

1. **Exportar cambios de BD a Excel:**
   - Crear script `export_clients_to_excel.py`
   - Leer datos de BD
   - Actualizar Excel preservando datos existentes
   
2. **Marcadores de tiempo:**
   - Agregar `updatedAt` para saber cuándo se editó un campo
   - Comparar timestamps para decidir qué dato es más reciente

3. **Interfaz de resolución de conflictos:**
   - Si BD y Excel tienen valores diferentes no vacíos
   - Mostrar UI para que usuario elija cuál mantener

---

**Última actualización:** 25 de Diciembre, 2025
**Versión:** 1.0 - Sincronización Bidireccional Básica
